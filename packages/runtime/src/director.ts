import type { GameConfig, ParticipantId, StageId } from '@heart/shared'
import { STAGE_META } from '@heart/shared'
import type { ActivityGroup, SlotPlan, Rng } from '@heart/engine'
import type { AgentService } from './agent-service'
import type { ChatScene} from './chat-scene';
import { type SceneOptions } from './chat-scene'
import type { House } from './house'
import type { HumanGateway } from './human-gateway'
import type { HumanViewProjector } from './human-view'
import type { PauseController } from './pause'
import { PD } from './pd'
import type { GameSession } from './session'
import type { Countdown, GameClock, TimerHost } from './timers'
import type { AvatarStore } from './ports'
import type { GpuLease, ImagePort } from '@heart/agents'

/** 단계 사이에 넘겨야 하는 런타임 객체(이벤트로 남길 필요가 없는 것). */
export interface SharedState {
  living: ChatScene | null
  votes: Partial<Record<StageId, string>>
  plans: Partial<Record<StageId, SlotPlan>>
  dayStartSeq: number
  /** 메기 입장 순서(시드로 정한다, game-rules.md §5.3) */
  catfishOrder?: ParticipantId[]
  activityGroups?: ActivityGroup[]
  /** 최종 결과(RESULT_REVEAL → EPILOGUE) */
  result?: { pairs: [ParticipantId, ParticipantId][]; humanPick: ParticipantId | null; partnerPick: ParticipantId | null }
}

export interface StageContext {
  readonly session: GameSession
  readonly config: GameConfig
  readonly house: House
  readonly agents: AgentService
  readonly human: HumanGateway
  readonly projector: HumanViewProjector
  readonly clock: GameClock
  readonly pause: PauseController
  readonly rng: Rng
  readonly shared: SharedState
  readonly image: ImagePort | null
  readonly lease: GpuLease
  readonly avatars: AvatarStore
  scaled(ms: number): number
  /** 화면 타이머와 함께 도는 대기. hold가 참인 동안 멈춘다. */
  countdown(label: string, ms: number, hold?: () => boolean): Countdown
  scene(opts: SceneOptions): ChatScene
}

/** design.md §4.2: 새 단계는 StageHandler 구현 + 레지스트리 등록으로 추가한다. */
export interface StageHandler {
  readonly id: StageId
  run(ctx: StageContext): Promise<void>
}

export class StageRegistry {
  private readonly handlers = new Map<StageId, StageHandler>()

  register(...handlers: StageHandler[]): this {
    for (const h of handlers) {
      if (this.handlers.has(h.id)) throw new Error(`stage already registered: ${h.id}`)
      this.handlers.set(h.id, h)
    }
    return this
  }

  get(id: StageId): StageHandler | undefined {
    return this.handlers.get(id)
  }
}

/**
 * 화면 타이머 동기화. 클라이언트는 받은 남은 시간을 스스로 줄여 나가고,
 * 멈춤 상태가 바뀌거나 오차가 커질 때만 서버가 다시 보낸다.
 */
export class TimerDisplay {
  private handle: unknown = null
  private token = 0

  constructor(
    private readonly host: TimerHost,
    private readonly projector: HumanViewProjector,
  ) {}

  show(label: string, countdown: Countdown): void {
    const token = ++this.token
    let lastHeld: boolean | null = null
    let lastSentRemaining = countdown.remaining()
    let lastSentAt = this.host.now()
    const push = (): void => {
      const held = countdown.held()
      const remaining = countdown.remaining()
      const expected = lastHeld ? lastSentRemaining : lastSentRemaining - (this.host.now() - lastSentAt)
      if (held !== lastHeld || Math.abs(expected - remaining) > 1500) {
        this.projector.setTimer({ label, totalMs: countdown.totalMs, remainingMs: remaining, paused: held })
        lastHeld = held
        lastSentRemaining = remaining
        lastSentAt = this.host.now()
      }
    }
    const loop = (): void => {
      if (token !== this.token) return
      push()
      this.handle = this.host.setTimeout(loop, 1000)
    }
    loop()
    void countdown.promise.then(() => {
      if (token !== this.token) return
      this.host.clearTimeout(this.handle)
      this.projector.setTimer(null)
    })
  }
}

export class Director {
  constructor(
    private readonly ctx: StageContext,
    private readonly registry: StageRegistry,
  ) {}

  /** 일정을 끝까지 돌면 'finished', 핸들러가 없는 단계에서 멈추면 'schedule_end'로 끝난다. */
  async run(): Promise<void> {
    const { session, config, house } = this.ctx
    let complete = true
    for (const stageId of config.schedule) {
      if (session.state.status === 'completed') return
      const handler = this.registry.get(stageId)
      if (!handler) {
        complete = false
        break
      }
      session.commit({ type: 'STAGE_STARTED', payload: { stage: stageId, simTime: STAGE_META[stageId].simTime }, visibility: { kind: 'house' } })
      await handler.run(this.ctx)
    }
    if (session.state.status !== 'completed') {
      this.ctx.shared.living?.stop()
      if (!complete) house.announce('not_implemented', PD.notImplemented())
      session.commit({ type: 'RUN_COMPLETED', payload: { reason: complete ? 'finished' : 'schedule_end' }, visibility: { kind: 'house' } })
    }
  }
}
