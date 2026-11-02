import type { DeliveryRecord } from '@signal/agents'
import type { AnyEvent, GameConfig } from '@signal/shared'
import { applyEvent, canObserve, containsName, createRunState, knownNameIds, type RunState } from '@signal/engine'
import { foldOptionsFor } from './session'

export interface Violation {
  rule: 'future_event' | 'unobservable_event' | 'foreign_memory' | 'canary_in_prompt' | 'canary_in_output' | 'memory_source_unobservable' | 'vote_visibility'
  detail: string
}

/**
 * 사후 감사(design.md §6.4). 모든 LLM 호출의 입력과 AI 출력이 가시성 규칙을 지켰는지 기계적으로 확인한다.
 */
export function auditRun(events: readonly AnyEvent[], deliveries: readonly DeliveryRecord[], config: GameConfig): Violation[] {
  const state: RunState = createRunState(events[0]?.runId ?? 'run')
  const fold = foldOptionsFor(config)
  for (const e of events) applyEvent(state, e, fold)
  const out: Violation[] = []
  const memoryOwner = new Map<string, string>()
  for (const m of state.memories) memoryOwner.set(m.memoryId, m.ownerId)
  const names = [...state.participants.values()].map((p) => ({ id: p.cast.id, name: p.cast.name }))

  for (const d of deliveries) {
    const owner = d.ownerId
    if (!owner) continue
    for (const seq of d.eventSeqs) {
      const e = state.events[seq - 1]
      if (!e) continue
      if (seq > d.seqAtCall) out.push({ rule: 'future_event', detail: `${d.callId} (${d.task}) used seq ${seq} > ${d.seqAtCall}` })
      else if (!canObserve(state, owner, e)) out.push({ rule: 'unobservable_event', detail: `${d.callId} (${d.task}) gave ${owner} ${e.type}#${seq}` })
    }
    for (const mid of d.memoryIds) {
      if (memoryOwner.get(mid) !== owner) out.push({ rule: 'foreign_memory', detail: `${d.callId} gave ${owner} memory ${mid}` })
    }
    const known = knownNameIds(state, owner, d.seqAtCall)
    for (const n of names) {
      if (known.has(n.id)) continue
      if (containsName(d.promptText, n.name)) out.push({ rule: 'canary_in_prompt', detail: `${d.callId} (${d.task}) mentioned unknown ${n.name} to ${owner}` })
    }
  }

  for (const e of state.events) {
    if (e.type === 'MESSAGE_SENT' && state.participants.get(e.actor)?.cast.isHuman === false) {
      const known = knownNameIds(state, e.actor, e.seq)
      for (const n of names) {
        if (!known.has(n.id) && containsName(e.payload.text, n.name)) {
          out.push({ rule: 'canary_in_output', detail: `${e.actor} said unknown name ${n.name} at #${e.seq}` })
        }
      }
    }
    if (e.type === 'MEMORY_RECORDED') {
      for (const s of e.payload.sourceSeqs) {
        const src = state.events[s - 1]
        if (src && !canObserve(state, e.payload.ownerId, src)) out.push({ rule: 'memory_source_unobservable', detail: `memory ${e.payload.memoryId} cites #${s}` })
      }
    }
    if (e.type === 'VOTE_COMMITTED') {
      const v = e.visibility
      if (v.kind !== 'participants' || v.ids.length !== 1 || v.ids[0] !== e.payload.voterId) {
        out.push({ rule: 'vote_visibility', detail: `vote #${e.seq} is visible beyond the voter` })
      }
    }
  }
  return out
}
