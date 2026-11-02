import type { GpuLease } from '@signal/agents'

/** design.md §7.6 우선순위. 숫자가 작을수록 먼저 처리한다. */
export const Priority = {
  P0_HUMAN_WAITING: 0,
  P1_SCENE: 1,
  P2_DECISION: 2,
  P3_PD: 3,
  P4_BACKGROUND: 4,
  P5_REFLECTION: 5,
} as const

export interface QueueJob<T> {
  priority: number
  label: string
  ownerId: string | null
  signal?: AbortSignal
  run: (signal: AbortSignal) => Promise<T>
}

interface Entry {
  job: QueueJob<unknown>
  order: number
  controller: AbortController
  resolve: (v: unknown) => void
  reject: (e: unknown) => void
}

function abortError(): Error {
  const err = new Error('aborted')
  err.name = 'AbortError'
  return err
}

/**
 * 단일 GPU 작업 큐(D14). 워커 1개가 우선순위 순서로 처리한다.
 * 취소된 작업은 꺼낼 때 버리고, 처리 중이면 AbortSignal로 끊는다.
 */
export class GpuQueue {
  private readonly entries: Entry[] = []
  private order = 0
  private running = false
  private idleWaiters: (() => void)[] = []

  constructor(private readonly lease: GpuLease) {}

  get pending(): number {
    return this.entries.length
  }

  enqueue<T>(job: QueueJob<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const controller = new AbortController()
      if (job.signal) {
        if (job.signal.aborted) return reject(abortError())
        job.signal.addEventListener('abort', () => controller.abort(), { once: true })
      }
      this.entries.push({ job: job as QueueJob<unknown>, order: this.order++, controller, resolve: resolve as (v: unknown) => void, reject })
      void this.pump()
    })
  }

  /** 마감이 다가온 작업을 앞당긴다(§7.6). */
  promote(predicate: (job: QueueJob<unknown>) => boolean, priority: number): void {
    for (const e of this.entries) if (predicate(e.job) && e.job.priority > priority) e.job.priority = priority
  }

  idle(): Promise<void> {
    if (!this.running && this.entries.length === 0) return Promise.resolve()
    return new Promise((r) => this.idleWaiters.push(r))
  }

  private async pump(): Promise<void> {
    if (this.running) return
    this.running = true
    try {
      for (;;) {
        const entry = this.takeNext()
        if (!entry) break
        if (entry.controller.signal.aborted) {
          entry.reject(abortError())
          continue
        }
        try {
          const value = await this.lease.use('llm', () => entry.job.run(entry.controller.signal))
          entry.resolve(value)
        } catch (err) {
          entry.reject(err)
        }
      }
    } finally {
      this.running = false
      const waiters = this.idleWaiters
      this.idleWaiters = []
      for (const w of waiters) w()
    }
  }

  private takeNext(): Entry | undefined {
    if (this.entries.length === 0) return undefined
    let best = 0
    for (let i = 1; i < this.entries.length; i++) {
      const a = this.entries[i] as Entry
      const b = this.entries[best] as Entry
      if (a.job.priority < b.job.priority || (a.job.priority === b.job.priority && a.order < b.order)) best = i
    }
    return this.entries.splice(best, 1)[0]
  }
}
