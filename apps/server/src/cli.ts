import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { defaultConfig } from '@heart/config'
import { auditRun } from '@heart/runtime'
import { SqliteRunStore } from '@heart/store'
import { readEnv } from './env'
import { runBench } from './bench'
import { drive } from './drive'
import { renderTranscript } from './transcript'
import { DEFAULT_SIM_HUMAN, runSimulation } from './sim'

/** 운영 CLI(design.md §16): sim, audit, doctor, bench, transcript */

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
      const bad = r.violations.length > 0 || r.completedReason !== 'finished'
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
  // 16GB PC 기준(docs/status.md "RAM 16GB 지원"): WSL이 기본으로 받는 메모리는 약 8GB이고, 실측 최대 사용량은 그 안에 든다.
  const mem = readMeminfo()
  if (mem) {
    checks.push([`메모리 총량 ${(mem.totalMb / 1024).toFixed(1)}GB (필요: 7.5GB 이상)`, mem.totalMb >= 7_500, 'WSL 메모리가 부족합니다. %UserProfile%\\.wslconfig 의 [wsl2] memory 값을 늘리세요'])
    checks.push([`지금 쓸 수 있는 메모리 ${(mem.availableMb / 1024).toFixed(1)}GB (권장: 6GB 이상)`, mem.availableMb >= 6_000, '실행 전에 무거운 IDE·언어 서버(예: Dart/Flutter 분석기)를 닫으세요'])
  }
  // 플레이는 항상 실제 모델로 한다(D32). 필요한 파일이 모두 있어야 서버가 시작된다.
  for (const [label, path, fix] of [
    ['llama-server', env.llamaBin, 'npm run setup:llm'],
    ['Qwen3.5-4B 모델', env.llamaModel, 'npm run setup:llm'],
    ['sd-cli', env.sdBin, 'npm run setup:image'],
    ['FLUX.2 klein 4B', env.sdDiffusionModel, 'npm run setup:image'],
    ['VAE', env.sdVae, 'npm run setup:image'],
    ['Qwen3-4B 텍스트 인코더', env.sdTextEncoder, 'npm run setup:image'],
  ] as const) {
    checks.push([`${label} ${path}`, existsSync(path), fix])
  }
  const vramNote = env.notes.find((n) => n.includes('VRAM'))
  checks.push([`llama.cpp 컨텍스트 ${env.contextSize}`, !vramNote, vramNote ?? ''])
  let bad = 0
  for (const [label, ok, fix] of checks) {
    console.log(`${ok ? '✓' : '✗'} ${label}${ok || !fix ? '' : `\n    → ${fix}`}`)
    if (!ok) bad++
  }
  return bad === 0 ? 0 : 1
}

async function driveCmd(args: string[]): Promise<number> {
  const env = readEnv()
  const reason = await drive({
    url: flag(args, '--url') ?? `ws://127.0.0.1:${env.port}/ws`,
    profile: args.includes('--create') ? DEFAULT_SIM_HUMAN : null,
    chatEveryMs: Number(flag(args, '--chat-every') ?? 25000),
    log: (line) => console.log(`[drive] ${line}`),
  })
  console.log(`[drive] finished: ${reason}`)
  return 0
}

function transcript(args: string[]): number {
  const runDir = args.find((a) => !a.startsWith('--') && a !== flag(args, '--as'))
  if (!runDir) {
    console.error('usage: transcript <runs/run_xxx> [--as p_00]')
    return 2
  }
  const runId = runDir.split('/').filter(Boolean).at(-1) ?? 'run'
  const store = new SqliteRunStore(join(runDir, 'run.sqlite'), runId)
  console.log(renderTranscript(store.loadEvents(), defaultConfig, flag(args, '--as') ?? null))
  store.close()
  return 0
}

async function bench(args: string[]): Promise<number> {
  const env = readEnv()
  const n = Number(flag(args, '--n') ?? 1)
  const report = await runBench({
    url: flag(args, '--url') ?? env.llamaUrl,
    label: flag(args, '--label') ?? 'local',
    perTask: { dialogue: 16 * n, vote: 4 * n, invite_decision: 2 * n, self_intro: 3 * n, relationship_eval: 4 * n, memory_summary: 3 * n, persona_profile: 2 * n, persona_voice: 2 * n },
    outDir: join(env.runsDir, 'bench'),
    timeoutMs: 120_000,
  })
  console.log(report)
  return 0
}

function readMeminfo(): { totalMb: number; availableMb: number } | null {
  try {
    const text = readFileSync('/proc/meminfo', 'utf8')
    const kb = (key: string): number => Number(new RegExp(`^${key}:\\s+(\\d+)`, 'm').exec(text)?.[1] ?? 0)
    return { totalMb: kb('MemTotal') / 1024, availableMb: kb('MemAvailable') / 1024 }
  } catch {
    return null
  }
}

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : undefined
}

const [cmd, ...rest] = process.argv.slice(2)
const COMMANDS: Record<string, (args: string[]) => number | Promise<number>> = { sim, audit, doctor: () => doctor(), bench, transcript, drive: driveCmd }
const run = cmd ? COMMANDS[cmd] : undefined
const code = run ? await run(rest) : (console.error('commands: sim [--seeds N] | audit <runDir> | doctor | bench [--url U] [--label L] [--n N] | transcript <runDir> [--as id] | drive [--create] [--url ws://…]'), 2)
process.exit(code)
