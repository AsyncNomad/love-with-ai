import { execFileSync } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { LlmRequest } from '@heart/agents'
import { LlamaCppLlm } from '@heart/inference'
import { runSimulation } from './sim'

/**
 * 실제 llama-server 측정(design.md §13, status.md Phase 1).
 * 시뮬레이션에서 실제 게임과 같은 형태의 요청을 뽑아 그대로 보낸다. 측정 항목:
 * 지연 p50/p95, 프롬프트 처리·생성 속도, JSON 준수율, thinking 출력 여부, 한국어 토큰 비율, VRAM.
 */

export interface BenchOptions {
  url: string
  label: string
  perTask: Record<string, number>
  outDir: string
  timeoutMs: number
}

interface Sample {
  task: string
  ms: number
  promptTokens: number | null
  completionTokens: number | null
  promptTps: number | null
  genTps: number | null
  jsonOk: boolean
  reasoning: boolean
  content: string
}

const KOREAN_SAMPLE =
  '안녕하세요! 저는 주말에 보통 집 근처 공원에서 러닝을 하고, 저녁에는 친구들이랑 맛집을 찾아다니는 걸 좋아해요. 혹시 다들 쉬는 날에는 뭐 하면서 보내세요? 저는 요즘 영화 보는 데 푹 빠져 있어서 추천받고 싶어요ㅋㅋ'

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] ?? 0
}

function vramMiB(): number | null {
  try {
    const out = execFileSync('nvidia-smi', ['--query-gpu=memory.used', '--format=csv,noheader,nounits'], { encoding: 'utf8' })
    return Number(out.trim().split('\n')[0])
  } catch {
    return null
  }
}

/** 시뮬레이션 한 판에서 작업별로 고르게 요청을 뽑는다. */
async function collectRequests(perTask: Record<string, number>): Promise<LlmRequest[]> {
  const byTask = new Map<string, LlmRequest[]>()
  await runSimulation({
    seed: 'bench',
    onRequest: (req) => {
      const list = byTask.get(req.task) ?? []
      // 시뮬레이션 중에 취소된 신호가 묻어 오지 않게 signal은 빼고 저장한다.
      const { signal: _signal, ...rest } = req
      list.push(rest)
      byTask.set(req.task, list)
    },
  })
  const out: LlmRequest[] = []
  for (const [task, n] of Object.entries(perTask)) {
    const list = byTask.get(task) ?? []
    // 게임 후반부 요청일수록 컨텍스트가 길다. 앞뒤를 고르게 섞어 뽑는다.
    const step = Math.max(1, Math.floor(list.length / Math.max(1, n)))
    for (let i = 0; i < list.length && out.filter((r) => r.task === task).length < n; i += step) out.push(list[i] as LlmRequest)
  }
  return out
}

export async function runBench(opts: BenchOptions): Promise<string> {
  const llm = new LlamaCppLlm({ baseUrl: opts.url, timeoutMs: opts.timeoutMs })
  if (!(await llm.health())) throw new Error(`llama-server가 응답하지 않습니다: ${opts.url}`)
  const requests = await collectRequests(opts.perTask)
  const vramBefore = vramMiB()
  const samples: Sample[] = []
  // 첫 요청은 워밍업으로 버린다.
  if (requests[0]) await llm.generate(requests[0]).catch(() => undefined)
  for (const req of requests) {
    const started = performance.now()
    try {
      const res = await llm.generate(req)
      const ms = performance.now() - started
      let jsonOk = false
      try {
        const parsed = JSON.parse(res.content) as Record<string, unknown>
        const required = (req.jsonSchema.required as string[] | undefined) ?? []
        jsonOk = required.every((k) => k in parsed)
      } catch {
        jsonOk = false
      }
      const t = res.timings
      samples.push({
        task: req.task,
        ms,
        promptTokens: res.promptTokens,
        completionTokens: res.completionTokens,
        promptTps: t && t.promptMs > 0 ? (t.promptTokens / t.promptMs) * 1000 : null,
        genTps: t && t.predictedMs > 0 ? (t.predictedTokens / t.predictedMs) * 1000 : null,
        jsonOk,
        reasoning: !!res.reasoning || res.content.includes('<think>'),
        content: res.content,
      })
    } catch (err) {
      samples.push({ task: req.task, ms: performance.now() - started, promptTokens: null, completionTokens: null, promptTps: null, genTps: null, jsonOk: false, reasoning: false, content: `ERROR ${String(err)}` })
    }
    process.stdout.write('.')
  }
  process.stdout.write('\n')
  const vramAfter = vramMiB()
  const koTokens = await llm.tokenize(KOREAN_SAMPLE).catch(() => 0)

  const lines: string[] = []
  lines.push(`# llama-server 측정: ${opts.label}`, '', `- 일시: ${new Date().toISOString()}`, `- 서버: ${opts.url}`)
  lines.push(`- VRAM 사용(측정 전/후, MiB): ${vramBefore ?? '?'} / ${vramAfter ?? '?'}`)
  lines.push(`- 한국어 토큰 비율: ${KOREAN_SAMPLE.length}자 → ${koTokens}토큰 (글자당 ${(koTokens / KOREAN_SAMPLE.length).toFixed(2)}토큰)`, '')
  lines.push('| 작업 | n | 지연 p50 | 지연 p95 | 프롬프트 토큰(평균) | 출력 토큰(평균) | 프롬프트 처리 tok/s | 생성 tok/s | JSON 준수 | thinking 출력 |')
  lines.push('|---|---|---|---|---|---|---|---|---|---|')
  const tasks = [...new Set(samples.map((s) => s.task)), 'ALL']
  for (const task of tasks) {
    const ss = task === 'ALL' ? samples : samples.filter((s) => s.task === task)
    const avg = (xs: (number | null)[]): string => {
      const v = xs.filter((x): x is number => x !== null)
      return v.length ? (v.reduce((a, b) => a + b, 0) / v.length).toFixed(0) : '-'
    }
    lines.push(
      `| ${task} | ${ss.length} | ${(percentile(ss.map((s) => s.ms), 50) / 1000).toFixed(2)}s | ${(percentile(ss.map((s) => s.ms), 95) / 1000).toFixed(2)}s | ${avg(ss.map((s) => s.promptTokens))} | ${avg(ss.map((s) => s.completionTokens))} | ${avg(ss.map((s) => s.promptTps))} | ${avg(ss.map((s) => s.genTps))} | ${ss.filter((s) => s.jsonOk).length}/${ss.length} | ${ss.filter((s) => s.reasoning).length} |`,
    )
  }
  lines.push('', '## 출력 예시', '')
  for (const task of new Set(samples.map((s) => s.task))) {
    lines.push(`### ${task}`)
    for (const s of samples.filter((x) => x.task === task).slice(0, 6)) lines.push(`- \`${s.content.replace(/\s+/g, ' ').slice(0, 240)}\``)
    lines.push('')
  }
  const report = lines.join('\n')
  await mkdir(opts.outDir, { recursive: true })
  const file = join(opts.outDir, `bench-${new Date().toISOString().replace(/[:.]/g, '-')}.md`)
  await writeFile(file, report)
  return `${report}\n\n(저장: ${file})`
}
