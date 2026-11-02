import type { GameClock } from './timers'
import type { GameSession } from './session'

export type PauseReason = 'disconnected' | 'llm_unavailable' | 'afk'

/**
 * 게임 전체 일시정지(design.md §12). 사유가 여럿 겹칠 수 있고, 모두 풀려야 재개한다.
 * 멈춘 동안에는 GameClock의 모든 대기가 흐르지 않는다.
 */
export class PauseController {
  private readonly reasons = new Set<PauseReason>()
  private waiters: (() => void)[] = []
  private readonly listeners = new Set<(reasons: ReadonlySet<PauseReason>) => void>()

  constructor(
    private readonly session: GameSession,
    private readonly clock: GameClock,
  ) {}

  get paused(): boolean {
    return this.reasons.size > 0
  }

  has(reason: PauseReason): boolean {
    return this.reasons.has(reason)
  }

  onChange(listener: (reasons: ReadonlySet<PauseReason>) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  pause(reason: PauseReason): void {
    if (this.reasons.has(reason) || this.session.state.status === 'completed') return
    const wasPaused = this.paused
    this.reasons.add(reason)
    if (!wasPaused) {
      this.clock.setPaused(true)
      this.session.commit({ type: 'RUN_PAUSED', payload: { reason }, visibility: { kind: 'house' } })
    }
    this.notify()
  }

  resume(reason: PauseReason): void {
    if (!this.reasons.delete(reason)) return
    if (!this.paused) {
      this.clock.setPaused(false)
      if (this.session.state.status === 'paused') this.session.commit({ type: 'RUN_RESUMED', payload: {}, visibility: { kind: 'house' } })
      const waiters = this.waiters
      this.waiters = []
      for (const w of waiters) w()
    }
    this.notify()
  }

  untilResumed(): Promise<void> {
    if (!this.paused) return Promise.resolve()
    return new Promise((r) => this.waiters.push(r))
  }

  private notify(): void {
    for (const l of [...this.listeners]) l(this.reasons)
  }
}
