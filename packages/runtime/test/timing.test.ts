import { describe, expect, it } from 'vitest'
import type { GpuLease } from '@signal/agents'
import { GameClock, GpuQueue, VirtualTimerHost } from '../src'

const lease: GpuLease = { use: (_kind, fn) => fn() }

describe('GameClock', () => {
  it('resolves after the requested time and stops while paused or held', async () => {
    const host = new VirtualTimerHost()
    const clock = new GameClock(host, 250)
    const log: string[] = []
    let held = false
    void clock.wait(1_000).promise.then(() => log.push(`plain@${host.now()}`))
    void clock.wait(1_000, () => held).promise.then(() => log.push(`held@${host.now()}`))
    host.setTimeout(() => (held = true), 500)
    host.setTimeout(() => (held = false), 2_500)
    host.setTimeout(() => clock.setPaused(true), 3_000)
    host.setTimeout(() => clock.setPaused(false), 5_000)
    await host.runUntil(() => log.length === 2, 60_000)
    expect(log[0]).toBe('plain@1000')
    // 500ms 흐른 뒤 2000ms 멈춤 → 2500부터 500ms 더 → 3000 직전에 끝난다(틱 오차 이내)
    const heldAt = Number(log[1]!.split('@')[1])
    expect(heldAt).toBeGreaterThanOrEqual(2_900)
    expect(heldAt).toBeLessThanOrEqual(3_250)
  })

  it('cancel resolves immediately and remaining reflects progress', async () => {
    const host = new VirtualTimerHost()
    const clock = new GameClock(host, 250)
    const c = clock.wait(10_000)
    let remainingAt4s = -1
    host.setTimeout(() => {
      remainingAt4s = c.remaining()
      c.cancel()
    }, 4_000)
    let done = false
    void c.promise.then(() => (done = true))
    await host.runUntil(() => done, 60_000)
    expect(remainingAt4s).toBeGreaterThan(5_500)
    expect(remainingAt4s).toBeLessThanOrEqual(6_250)
  })
})

describe('GpuQueue', () => {
  it('runs one job at a time in priority order', async () => {
    const q = new GpuQueue(lease)
    const order: string[] = []
    let release!: () => void
    const blocker = q.enqueue({ priority: 3, label: 'first', ownerId: null, run: () => new Promise<void>((r) => (release = r)).then(() => void order.push('first')) })
    const low = q.enqueue({ priority: 5, label: 'low', ownerId: null, run: async () => void order.push('low') })
    const high = q.enqueue({ priority: 0, label: 'high', ownerId: null, run: async () => void order.push('high') })
    await new Promise((r) => setImmediate(r))
    release()
    await Promise.all([blocker, low, high])
    expect(order).toEqual(['first', 'high', 'low'])
  })

  it('drops jobs aborted before they start and supports promotion', async () => {
    const q = new GpuQueue(lease)
    const order: string[] = []
    let release!: () => void
    const blocker = q.enqueue({ priority: 0, label: 'b', ownerId: null, run: () => new Promise<void>((r) => (release = r)) })
    const ctl = new AbortController()
    const dropped = q.enqueue({ priority: 1, label: 'x', ownerId: null, signal: ctl.signal, run: async () => void order.push('x') })
    const reflect = q.enqueue({ priority: 5, label: 'reflect', ownerId: null, run: async () => void order.push('reflect') })
    const scene = q.enqueue({ priority: 4, label: 'scene', ownerId: null, run: async () => void order.push('scene') })
    ctl.abort()
    q.promote((job) => job.label === 'reflect', 2)
    release()
    await expect(dropped).rejects.toMatchObject({ name: 'AbortError' })
    await Promise.all([blocker, reflect, scene])
    expect(order).toEqual(['reflect', 'scene'])
  })
})
