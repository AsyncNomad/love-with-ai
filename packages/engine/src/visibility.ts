import type { AnyEvent, ParticipantId } from '@signal/shared'
import { eventRoomId } from '@signal/shared'
import type { RunState } from './state'

/**
 * 모든 가시성 판정의 단일 진입점(design.md §6.1).
 * 이벤트를 상태에 반영한 뒤에 호출해야 한다. 그래야 입장 이벤트를 입장자 본인이 관찰한다.
 */
export function canObserve(state: RunState, observer: ParticipantId, event: AnyEvent): boolean {
  const v = event.visibility
  switch (v.kind) {
    case 'server':
      return false
    case 'participants':
      return v.ids.includes(observer)
    case 'house':
      return isInHouseAt(state, observer, event.seq)
    case 'room': {
      const roomId = eventRoomId(event)
      return roomId !== null && isMemberAt(state, roomId, observer, event.seq)
    }
  }
}

export function isMemberAt(state: RunState, roomId: string, pid: ParticipantId, seq: number): boolean {
  const room = state.rooms.get(roomId)
  if (!room) return false
  return room.memberships.some(
    (m) => m.participantId === pid && m.joinedSeq <= seq && (m.leftSeq === null || seq <= m.leftSeq),
  )
}

export function isInHouseAt(state: RunState, pid: ParticipantId, seq: number): boolean {
  const entered = state.participants.get(pid)?.enteredSeq
  return entered !== null && entered !== undefined && entered <= seq
}

export interface KnownProfile {
  id: ParticipantId
  name: string | null
  age: number | null
  occupation: string | null
  /** 이 지식을 만든 공개 이벤트 seq */
  sourceSeqs: number[]
}

/**
 * observer가 subject에 대해 알고 있는 신상. 본인은 자기 정보를 전부 안다.
 * 다른 사람에 대해서는 관찰한 PROFILE_DISCLOSED 이벤트만 반영한다(design.md §6.3).
 */
export function knownProfile(
  state: RunState,
  observer: ParticipantId,
  subject: ParticipantId,
  uptoSeq = state.lastSeq,
): KnownProfile {
  const rec = state.participants.get(subject)
  if (!rec) return { id: subject, name: null, age: null, occupation: null, sourceSeqs: [] }
  if (observer === subject) {
    return { id: subject, name: rec.cast.name, age: rec.cast.age, occupation: rec.cast.occupation, sourceSeqs: [] }
  }
  const out: KnownProfile = { id: subject, name: null, age: null, occupation: null, sourceSeqs: [] }
  for (const e of state.events) {
    if (e.seq > uptoSeq) break
    if (e.type !== 'PROFILE_DISCLOSED' || e.payload.subjectId !== subject) continue
    if (!canObserve(state, observer, e)) continue
    const f = e.payload.fields
    if (f.name !== undefined) out.name = f.name
    if (f.age !== undefined) out.age = f.age
    if (f.occupation !== undefined) out.occupation = f.occupation
    out.sourceSeqs.push(e.seq)
  }
  return out
}

/** observer가 seq 시점에 이름을 아는 참가자 집합(본인 포함). canary 검사에 쓴다. */
export function knownNameIds(state: RunState, observer: ParticipantId, uptoSeq = state.lastSeq): Set<ParticipantId> {
  const out = new Set<ParticipantId>([observer])
  for (const e of state.events) {
    if (e.seq > uptoSeq) break
    if (e.type === 'PROFILE_DISCLOSED' && e.payload.fields.name !== undefined && canObserve(state, observer, e)) {
      out.add(e.payload.subjectId)
    }
  }
  return out
}
