import { AgentRunner, type GpuLease, type ImagePort, type LlmPort } from '@heart/agents'
import type { Command, GameConfig, HumanProfile } from '@heart/shared'
import { createRng, oppositeGenderRule } from '@heart/engine'
import { AgentService } from './agent-service'
import { ChatScene } from './chat-scene'
import { Director, StageRegistry, TimerDisplay, type SharedState, type StageContext } from './director'
import { GpuQueue } from './gpu-queue'
import { House } from './house'
import { HumanGateway, type CommandResult } from './human-gateway'
import { HumanViewProjector } from './human-view'
import { PauseController } from './pause'
import type { AvatarStore, RunSink } from './ports'
import { GameSession } from './session'
import { castingStage } from './stages/casting'
import { day1Stages } from './stages/day1'
import { day2Stages } from './stages/day2'
import { day3Stages } from './stages/day3'
import { GameClock, type TimerHost } from './timers'

export interface GameDeps {
  runId: string
  seed: string
  config: GameConfig
  sink: RunSink
  llm: LlmPort
  lease: GpuLease
  image: ImagePort | null
  avatars: AvatarStore
  host: TimerHost
  registry?: StageRegistry
}

export function defaultRegistry(): StageRegistry {
  return new StageRegistry().register(castingStage, ...day1Stages, ...day2Stages, ...day3Stages)
}

/**
 * 회차 하나의 조립. 의존성은 모두 주입받으므로 실제 서버와 헤드리스 시뮬레이션이 같은 코드를 쓴다.
 */
export class Game {
  readonly session: GameSession
  readonly projector: HumanViewProjector
  readonly gateway: HumanGateway
  readonly pause: PauseController
  readonly clock: GameClock
  readonly queue: GpuQueue
  readonly agents: AgentService
  private readonly director: Director
  private started = false
  private callCounter = 0

  constructor(private readonly deps: GameDeps) {
    const { config, host } = deps
    const startedAt = host.now()
    this.session = new GameSession(deps.runId, config, deps.sink, () => host.now() - startedAt)
    this.clock = new GameClock(host, config.timing.tickMs)
    this.pause = new PauseController(this.session, this.clock)
    this.projector = new HumanViewProjector(this.session)
    const house = new House(this.session)
    this.gateway = new HumanGateway(this.session, house, this.projector, this.pause, oppositeGenderRule)
    this.queue = new GpuQueue(deps.lease)
    const rng = createRng(deps.seed)
    const runner = new AgentRunner({
      llm: deps.llm,
      context: () => ({ state: this.session.state, config }),
      recordDelivery: (d) => deps.sink.recordDelivery(d),
      recordCall: (c) => deps.sink.recordCall(c),
      newId: () => `c_${String(++this.callCounter).padStart(5, '0')}`,
      now: () => host.now(),
    })
    this.agents = new AgentService(this.session, runner, this.queue, this.pause, rng.fork('agents'))
    const timers = new TimerDisplay(host, this.projector)
    const shared: SharedState = { living: null, votes: {}, plans: {}, dayStartSeq: 0 }
    const sceneRng = rng.fork('scenes')
    const ctx: StageContext = {
      session: this.session,
      config,
      house,
      agents: this.agents,
      human: this.gateway,
      projector: this.projector,
      clock: this.clock,
      pause: this.pause,
      rng: rng.fork('stages'),
      shared,
      image: deps.image,
      lease: deps.lease,
      avatars: deps.avatars,
      scaled: (ms) => Math.round(ms * this.session.state.timeScale),
      countdown: (label, ms, hold) => {
        const c = this.clock.wait(ms, hold)
        timers.show(label, c)
        return c
      },
      scene: (opts) =>
        new ChatScene(
          { session: this.session, house, agents: this.agents, clock: this.clock, rng: sceneRng, typing: (roomId, ids) => this.projector.setTyping(roomId, ids) },
          opts,
        ),
    }
    this.director = new Director(ctx, deps.registry ?? defaultRegistry())
    this.pause.onChange((reasons) => {
      const blocking = reasons.has('llm_unavailable') ? 'llm_unavailable' : reasons.has('afk') ? 'afk' : null
      if (blocking) this.projector.upsertPrompt({ id: 'resume', kind: 'resume', reason: blocking })
      else this.projector.resolvePrompt('resume')
    })
  }

  /** 회차를 시작하고, 일정이 끝날 때까지 진행한다. */
  async start(profile: HumanProfile): Promise<void> {
    if (this.started) throw new Error('game already started')
    this.started = true
    this.session.commit({
      type: 'RUN_CREATED',
      payload: { seed: this.deps.seed, human: profile, timeScale: this.deps.config.timing.timeScale },
      visibility: { kind: 'server' },
      idempotencyKey: 'run_created',
    })
    await this.director.run()
  }

  handle(commandId: string, command: Command): CommandResult {
    return this.gateway.handle(commandId, command)
  }

  humanConnected(): void {
    this.pause.resume('disconnected')
  }

  humanDisconnected(): void {
    if (this.session.state.status === 'running') this.pause.pause('disconnected')
  }
}
