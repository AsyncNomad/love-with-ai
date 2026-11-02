import { describe, expect, it } from 'vitest'
import { defaultConfig } from '@heart/config'
import { applyEvent, canObserve, createRunState } from '@heart/engine'
import { foldOptionsFor } from '@heart/runtime'
import { DEFAULT_SIM_HUMAN, runSimulation } from '../src/sim'

describe('headless day-1 simulation (FakeLlm, virtual clock)', () => {
  it.each(['s1', 's2', 's3', 's4'])('completes day 1 with zero audit violations (%s)', async (seed) => {
    const human = seed === 's2' || seed === 's4' ? { ...DEFAULT_SIM_HUMAN, gender: 'female' as const, name: '이수빈' } : DEFAULT_SIM_HUMAN
    const r = await runSimulation({ seed, human })
    expect(r.completedReason).toBe('schedule_end')
    expect(r.violations).toEqual([])
    const types = new Set(r.sink.events.map((e) => e.type))
    for (const t of ['VOTE_COMMITTED', 'MESSAGE_SENT', 'PROFILE_DISCLOSED', 'RELATIONSHIP_UPDATED', 'MEMORY_RECORDED', 'AVATAR_READY']) expect(types).toContain(t)
  })

  it('is deterministic for the same seed', async () => {
    const a = await runSimulation({ seed: 'det' })
    const b = await runSimulation({ seed: 'det' })
    expect(a.sink.events.map((e) => `${e.type}:${JSON.stringify(e.payload)}`)).toEqual(b.sink.events.map((e) => `${e.type}:${JSON.stringify(e.payload)}`))
  })

  it('keeps catfish completely out of day 1 and gives each AI only its own vote', async () => {
    const r = await runSimulation({ seed: 'iso' })
    const state = createRunState('x')
    const fold = foldOptionsFor(defaultConfig)
    for (const e of r.sink.events) applyEvent(state, e, fold)
    const catfish = [...state.participants.values()].filter((p) => p.cast.isCatfish)
    expect(catfish).toHaveLength(2)
    for (const c of catfish) {
      expect(c.enteredSeq).toBeNull()
      for (const d of r.sink.deliveries) if (d.task !== 'persona_profile' && d.task !== 'persona_voice') expect(d.promptText).not.toContain(c.cast.name)
    }
    for (const e of r.sink.events) {
      if (e.type !== 'VOTE_COMMITTED') continue
      for (const p of state.participants.keys()) expect(canObserve(state, p, e)).toBe(p === e.payload.voterId)
    }
  })
})
