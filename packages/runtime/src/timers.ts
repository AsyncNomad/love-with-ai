/**
 * 시간 추상화(D15). 실제 실행은 단조 시계(performance.now)를, 시뮬레이션은 가상 시계를 쓴다.
 */
export interface TimerHost {
  now(): number
  setTimeout(fn: () => void, ms: number): unknown
  clearTimeout(handle: unknown): void
}

export const realTimerHost: TimerHost = {
  now: () => performance.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
}

interface VirtualTimer {
  at: number
  order: number
  fn: () => void
  cancelled: boolean
}

/** 기다리지 않고 시간을 건너뛰는 시계. 수천 판 시뮬레이션에 쓴다. */
export class VirtualTimerHost implements TimerHost {
  private t = 0
  private order = 0
  private timers: VirtualTimer[] = []

  now(): number {
    return this.t
  }

  setTimeout(fn: () => void, ms: number): unknown {
    const timer: VirtualTimer = { at: this.t + Math.max(0, ms), order: this.order++, fn, cancelled: false }
    this.timers.push(timer)
    return timer
  }

  clearTimeout(handle: unknown): void {
    if (handle) (handle as VirtualTimer).cancelled = true
  }

  /** done()이 참이 될 때까지 타이머를 시간 순서대로 실행한다. 할 일이 없는데 끝나지 않으면 교착이다. */
  async runUntil(done: () => boolean, maxVirtualMs: number): Promise<void> {
    for (;;) {
      await flushMicrotasks()
      if (done()) return
      this.timers = this.timers.filter((x) => !x.cancelled)
      if (this.timers.length === 0) {
        await flushMicrotasks()
        if (done()) return
        throw new Error(`virtual clock deadlock at t=${this.t}ms`)
      }
      this.timers.sort((a, b) => a.at - b.at || a.order - b.order)
      const next = this.timers.shift() as VirtualTimer
      if (next.at > maxVirtualMs) throw new Error(`virtual clock exceeded ${maxVirtualMs}ms`)
      this.t = Math.max(this.t, next.at)
      next.fn()
    }
  }
}

async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 3; i++) await new Promise<void>((r) => setImmediate(r))
}

export interface Countdown {
  readonly totalMs: number
  readonly promise: Promise<void>
  remaining(): number
  held(): boolean
  cancel(): void
}

interface Wait {
  total: number
  elapsed: number
  hold: (() => boolean) | undefined
  resolve: () => void
}

/**
 * 일시정지를 아는 시계. 게임이 멈춘 동안, 또는 hold()가 참인 동안에는 대기 시간이 흐르지 않는다.
 * 모든 대기를 하나의 틱 루프가 관리한다.
 */
export class GameClock {
  private readonly waits = new Set<Wait>()
  private paused = false
  private last = 0
  private handle: unknown = null

  constructor(
    private readonly host: TimerHost,
    private readonly tickMs: number,
  ) {}

  now(): number {
    return this.host.now()
  }

  isPaused(): boolean {
    return this.paused
  }

  setPaused(paused: boolean): void {
    this.tick()
    this.paused = paused
  }

  wait(ms: number, hold?: () => boolean): Countdown {
    let resolve!: () => void
    const promise = new Promise<void>((r) => (resolve = r))
    const w: Wait = { total: Math.max(0, ms), elapsed: 0, hold, resolve }
    if (w.total === 0) {
      resolve()
    } else {
      if (this.waits.size === 0) this.last = this.host.now()
      else this.tick()
      this.waits.add(w)
      this.schedule()
    }
    return {
      totalMs: w.total,
      promise,
      remaining: () => Math.max(0, w.total - w.elapsed),
      held: () => this.paused || (w.hold?.() ?? false),
      cancel: () => {
        if (this.waits.delete(w)) w.resolve()
      },
    }
  }

  sleep(ms: number): Promise<void> {
    return this.wait(ms).promise
  }

  private schedule(): void {
    if (this.handle !== null || this.waits.size === 0) return
    let next = this.tickMs
    if (!this.paused) {
      for (const w of this.waits) if (!(w.hold?.() ?? false)) next = Math.min(next, w.total - w.elapsed)
    }
    this.handle = this.host.setTimeout(() => {
      this.handle = null
      this.tick()
      this.schedule()
    }, Math.max(1, next))
  }

  private tick(): void {
    const now = this.host.now()
    const dt = now - this.last
    this.last = now
    if (this.paused) return
    for (const w of [...this.waits]) {
      if (w.hold?.()) continue
      w.elapsed += dt
      if (w.elapsed >= w.total - 0.5) {
        this.waits.delete(w)
        w.resolve()
      }
    }
  }
}
