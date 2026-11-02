import { fakeResponders } from '@signal/agents'
import { defaultConfig } from '@signal/config'
import { createRng } from '@signal/engine'
import { FakeImage, FakeLlm, PassthroughLease } from '@signal/inference'
import { Game, MemoryAvatarStore, MemorySink, VirtualTimerHost, auditRun, type TimerHost, type Violation } from '@signal/runtime'
import type { GameConfig, HumanProfile } from '@signal/shared'
import { SimHuman } from './sim-human'

export interface SimOptions {
  seed: string
  config?: GameConfig
  human?: HumanProfile
  maxVirtualMs?: number
}

export interface SimResult {
  seed: string
  completedReason: string | null
  virtualMs: number
  events: number
  llmCalls: number
  rejected: number
  violations: Violation[]
  sink: MemorySink
}

export const DEFAULT_SIM_HUMAN: HumanProfile = {
  name: '김지수',
  gender: 'male',
  age: 27,
  region: '서울 마포구',
  occupation: '개발자',
  personality: '처음엔 조용하지만 친해지면 장난이 많다',
  interests: ['영화', '러닝'],
}

export function virtualSleep(host: TimerHost) {
  return (ms: number, signal?: AbortSignal): Promise<void> =>
    new Promise((resolve, reject) => {
      const h = host.setTimeout(resolve, ms)
      signal?.addEventListener(
        'abort',
        () => {
          host.clearTimeout(h)
          const err = new Error('aborted')
          err.name = 'AbortError'
          reject(err)
        },
        { once: true },
      )
    })
}

/**
 * GPU 없이 가상 시계로 한 판을 끝까지 돌리고 감사한다(design.md §15.2 시뮬레이션 층).
 */
export async function runSimulation(opts: SimOptions): Promise<SimResult> {
  const config = opts.config ?? defaultConfig
  const host = new VirtualTimerHost()
  const sink = new MemorySink()
  const rng = createRng(opts.seed)
  const game = new Game({
    runId: `sim_${opts.seed}`,
    seed: opts.seed,
    config,
    sink,
    llm: new FakeLlm({ rng: rng.fork('fake-llm'), responders: fakeResponders, latencyMs: { min: 400, max: 2500 }, sleep: virtualSleep(host) }),
    lease: new PassthroughLease(),
    image: new FakeImage(),
    avatars: new MemoryAvatarStore(),
    host,
  })
  const bot = new SimHuman(game, rng.fork('human'), host, { chatIntervalMs: { min: 8_000, max: 40_000 }, respondDelayMs: { min: 1_000, max: 15_000 } })
  let finished = false
  let failure: unknown = null
  game.start(opts.human ?? DEFAULT_SIM_HUMAN).then(
    () => (finished = true),
    (err: unknown) => {
      failure = err
      finished = true
    },
  )
  try {
    await host.runUntil(() => finished, opts.maxVirtualMs ?? 6 * 3600_000)
  } finally {
    bot.stop()
  }
  if (failure) throw failure
  return {
    seed: opts.seed,
    completedReason: game.session.state.completedReason,
    virtualMs: host.now(),
    events: sink.events.length,
    llmCalls: sink.calls.length,
    rejected: sink.calls.filter((c) => c.outcome === 'rejected').length,
    violations: auditRun(sink.events, sink.deliveries, config),
    sink,
  }
}
