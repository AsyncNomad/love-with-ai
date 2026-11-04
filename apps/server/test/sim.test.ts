import { describe, expect, it } from 'vitest'
import { defaultConfig } from '@heart/config'
import { applyEvent, canObserve, createRunState } from '@heart/engine'
import { foldOptionsFor } from '@heart/runtime'
import { DEFAULT_SIM_HUMAN, runSimulation } from '../src/sim'

describe('headless 3-day simulation (FakeLlm, virtual clock)', () => {
  it.each(['s1', 's2', 's3', 's4'])('completes all three days with zero audit violations (%s)', async (seed) => {
    const human = seed === 's2' || seed === 's4' ? { ...DEFAULT_SIM_HUMAN, gender: 'female' as const, name: '이수빈' } : DEFAULT_SIM_HUMAN
    const r = await runSimulation({ seed, human })
    expect(r.completedReason).toBe('finished')
    expect(r.violations).toEqual([])
    const types = new Set(r.sink.events.map((e) => e.type))
    for (const t of ['VOTE_COMMITTED', 'MESSAGE_SENT', 'PROFILE_DISCLOSED', 'RELATIONSHIP_UPDATED', 'MEMORY_RECORDED', 'AVATAR_READY', 'ACTIVITY_CHOSEN', 'SIGNAL_CARD_SENT', 'MAILBOX_QUESTION', 'MATCHES_COMPUTED']) {
      expect(types).toContain(t)
    }
    const stages = r.sink.events.flatMap((e) => (e.type === 'STAGE_STARTED' ? [e.payload.stage] : []))
    expect(stages).toEqual(defaultConfig.schedule)
  })

  it('is deterministic for the same seed', async () => {
    const a = await runSimulation({ seed: 'det' })
    const b = await runSimulation({ seed: 'det' })
    expect(a.sink.events.map((e) => `${e.type}:${JSON.stringify(e.payload)}`)).toEqual(b.sink.events.map((e) => `${e.type}:${JSON.stringify(e.payload)}`))
  })

  it('keeps catfish out of everything before they enter and gives each AI only its own vote', async () => {
    const r = await runSimulation({ seed: 'iso' })
    const state = createRunState('x')
    const fold = foldOptionsFor(defaultConfig)
    for (const e of r.sink.events) applyEvent(state, e, fold)
    const catfish = [...state.participants.values()].filter((p) => p.cast.isCatfish)
    expect(catfish).toHaveLength(2)
    for (const c of catfish) {
      const entered = c.enteredSeq
      expect(entered).not.toBeNull()
      for (const d of r.sink.deliveries) {
        if (d.task === 'persona_profile' || d.task === 'persona_voice' || d.seqAtCall >= (entered ?? 0)) continue
        expect(d.promptText).not.toContain(c.cast.name)
      }
      // 입장 전 대화는 메기가 관찰할 수 없다(기존 관계 요약도 주지 않는다, game-rules.md §5.3).
      for (const e of r.sink.events) if (e.type === 'MESSAGE_SENT' && e.seq < (entered ?? 0)) expect(canObserve(state, c.cast.id, e)).toBe(false)
    }
    for (const e of r.sink.events) {
      if (e.type !== 'VOTE_COMMITTED') continue
      for (const p of state.participants.keys()) expect(canObserve(state, p, e)).toBe(p === e.payload.voterId)
    }
  })

  it('keeps the client view (built only from patches) identical to the server snapshot', async () => {
    const r = await runSimulation({ seed: 'client-view' })
    expect(r.clientView.meId).not.toBeNull()
    expect(r.clientView).toEqual(r.serverView)
  })

  it('delivers anonymous cards without any trace of the sender', async () => {
    const r = await runSimulation({ seed: 'cards' })
    const received = r.sink.events.filter((e) => e.type === 'SIGNAL_CARD_RECEIVED')
    expect(received.length).toBeGreaterThan(0)
    for (const e of received) {
      expect(Object.keys(e.payload).sort()).toEqual(['recipientId', 'text'])
      expect(e.actor).toBe('server')
    }
  })
})
