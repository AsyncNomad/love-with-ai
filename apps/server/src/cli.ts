import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { defaultConfig } from '@heart/config'
import { LlamaCppLlm } from '@heart/inference'
import { auditRun } from '@heart/runtime'
import { SqliteRunStore } from '@heart/store'
import { readEnv } from './env'
import { DEFAULT_SIM_HUMAN, runSimulation } from './sim'

/** 운영 CLI(design.md §16): sim, audit, doctor */

async function sim(args: string[]): Promise<number> {
  const n = Number(flag(args, '--seeds') ?? 20)
  const from = Number(flag(args, '--from') ?? 0)
  let failed = 0
  const started = Date.now()
  for (let i = from; i < from + n; i++) {
    const seed = `seed-${i}`
    try {
      const human = i % 2 === 1 ? { ...DEFAULT_SIM_HUMAN, name: '이수빈', gender: 'female' as const } : DEFAULT_SIM_HUMAN
      const r = await runSimulation({ seed, human })
      const bad = r.violations.length > 0 || r.completedReason !== 'schedule_end'
      if (bad) failed++
      if (bad || n <= 20) {
        console.log(`${bad ? 'FAIL' : 'ok  '} ${seed} reason=${r.completedReason} virtual=${Math.round(r.virtualMs / 60000)}min events=${r.events} calls=${r.llmCalls} violations=${r.violations.length}`)
        for (const v of r.violations.slice(0, 5)) console.log(`     - ${v.rule}: ${v.detail}`)
      }
    } catch (err) {
      failed++
      console.log(`CRASH ${seed}: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`)
    }
  }
  console.log(`\n${n - failed}/${n} passed in ${((Date.now() - started) / 1000).toFixed(1)}s`)
  return failed === 0 ? 0 : 1
}

function audit(args: string[]): number {
  const runDir = args[0]
  if (!runDir) {
    console.error('usage: audit <runs/run_xxx>')
    return 2
  }
  const path = join(runDir, 'run.sqlite')
  if (!existsSync(path)) {
    console.error(`not found: ${path}`)
    return 2
  }
  const runId = runDir.split('/').filter(Boolean).at(-1) ?? 'run'
  const store = new SqliteRunStore(path, runId)
  const violations = auditRun(store.loadEvents(), store.loadDeliveries(), defaultConfig)
  console.table(store.callStats())
  store.close()
  if (violations.length === 0) {
    console.log('audit: 0 violations')
    return 0
  }
  for (const v of violations) console.log(`${v.rule}: ${v.detail}`)
  return 1
}

async function doctor(): Promise<number> {
  const env = readEnv()
  const checks: [string, boolean, string][] = []
  const major = Number(process.versions.node.split('.')[0])
  checks.push(['node >= 22', major >= 22, `현재 ${process.versions.node}. nvm install 24`])
  checks.push([`LLM_MODE=${env.llmMode}`, true, ''])
  if (env.llmMode === 'llamacpp') {
    checks.push([`llama-server 바이너리 ${env.llamaBin}`, existsSync(env.llamaBin), 'WSL에서 CUDA로 빌드한 llama-server를 bin/에 두거나 LLAMA_BIN을 지정'])
    checks.push([`모델 ${env.llamaModel}`, existsSync(env.llamaModel), 'Qwen3.5-4B Q4_K_M GGUF를 models/에 두거나 LLAMA_MODEL을 지정'])
  }
  if (env.llmMode !== 'fake') {
    const ok = await new LlamaCppLlm({ baseUrl: env.llamaUrl, timeoutMs: 3000 }).health()
    checks.push([`llama-server 응답 ${env.llamaUrl}/health`, ok || env.llmMode === 'llamacpp', '외부 모드라면 llama-server를 먼저 실행'])
  }
  if (env.imageMode === 'sdcpp') {
    for (const [label, path] of [
      ['sd-cli', env.sdBin],
      ['FLUX.2 klein 4B', env.sdDiffusionModel],
      ['VAE', env.sdVae],
      ['Qwen3-4B 텍스트 인코더', env.sdTextEncoder],
    ] as const) {
      checks.push([`${label} ${path}`, existsSync(path), `${label} 경로를 확인`])
    }
  }
  let bad = 0
  for (const [label, ok, fix] of checks) {
    console.log(`${ok ? '✓' : '✗'} ${label}${ok || !fix ? '' : `\n    → ${fix}`}`)
    if (!ok) bad++
  }
  return bad === 0 ? 0 : 1
}

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : undefined
}

const [cmd, ...rest] = process.argv.slice(2)
const code = cmd === 'sim' ? await sim(rest) : cmd === 'audit' ? audit(rest) : cmd === 'doctor' ? await doctor() : (console.error('commands: sim [--seeds N] | audit <runDir> | doctor'), 2)
process.exit(code)
