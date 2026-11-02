import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { defaultConfig } from '@signal/config'
import type { AnyEvent, CastParticipant, EventDraft } from '@signal/shared'
import { EVENT_SCHEMA_VERSION } from '@signal/shared'
import { applyEvent, canObserve, castHuman, createRunState, findMentions, type FoldOptions, type RunState } from '@signal/engine'
import { ObservationView, dialogueTask } from '../src'

const fold: FoldOptions = {
  relationshipInitial: defaultConfig.relationship.initial,
  interactionWeights: defaultConfig.relationship.exposureWeights,
  mentions: (s, text, ids) => findMentions(text, ids.map((id) => ({ id, name: s.participants.get(id)?.cast.name ?? '' }))),
}

function push(state: RunState, draft: EventDraft): AnyEvent {
  const e = { ...draft, runId: 'r', seq: state.lastSeq + 1, actor: draft.actor ?? 'server', simTime: 'D1 20:00', wallMs: 0, idempotencyKey: null, schemaVersion: EVENT_SCHEMA_VERSION } as AnyEvent
  applyEvent(state, e, fold)
  return e
}

const PEOPLE: [string, string, 'male' | 'female'][] = [
  ['a', '이서윤', 'female'],
  ['b', '박도현', 'male'],
  ['c', '최하린', 'female'],
  ['d', '김태오', 'male'],
]

function setup(): RunState {
  const s = createRunState('r')
  for (const [id, name, gender] of PEOPLE) {
    const cast: CastParticipant = { ...castHuman({ name, gender, age: 25, region: '서울', occupation: '대학생', personality: '', interests: [] }), id, isHuman: false }
    push(s, { type: 'PARTICIPANT_CAST', payload: { participant: cast }, visibility: { kind: 'participants', ids: [id] } })
  }
  for (const [id, name] of PEOPLE) {
    push(s, { type: 'HOUSE_ENTERED', payload: { participantId: id }, visibility: { kind: 'house' } })
    push(s, { type: 'PROFILE_DISCLOSED', payload: { subjectId: id, fields: { name } }, visibility: { kind: 'house' } })
  }
  push(s, { type: 'ROOM_OPENED', payload: { roomId: 'living', kind: 'living', location: '거실' }, visibility: { kind: 'server' } })
  push(s, { type: 'ROOM_OPENED', payload: { roomId: 'yard', kind: 'private', location: '마당' }, visibility: { kind: 'server' } })
  return s
}

describe('ObservationView isolation', () => {
  it('never puts a private conversation into an outsider’s dialogue prompt', () => {
    const s = setup()
    for (const id of ['a', 'b']) push(s, { type: 'MEMBER_JOINED', payload: { roomId: 'yard', participantId: id }, visibility: { kind: 'room' } })
    for (const id of ['c', 'd']) push(s, { type: 'MEMBER_JOINED', payload: { roomId: 'living', participantId: id }, visibility: { kind: 'room' } })
    push(s, { type: 'MESSAGE_SENT', actor: 'a', payload: { roomId: 'yard', text: '사실 나 도현씨가 제일 좋아', background: true }, visibility: { kind: 'room' } })
    push(s, { type: 'MESSAGE_SENT', actor: 'd', payload: { roomId: 'living', text: '다들 어디 갔지?', background: false }, visibility: { kind: 'room' } })

    const built = dialogueTask.build({ speakerId: 'c', roomId: 'living', mode: 'reply', isPrivate: false }, { state: s, config: defaultConfig })
    expect(built.user).not.toContain('제일 좋아')
    expect(built.user).toContain('다들 어디 갔지?')
    for (const seq of built.view?.touched ?? []) expect(canObserve(s, 'c', s.events[seq - 1]!)).toBe(true)
  })

  it('every event a view touches is observable by its owner (random scenarios)', () => {
    const op = fc.oneof(
      fc.record({ kind: fc.constant('join' as const), who: fc.constantFrom('a', 'b', 'c', 'd'), room: fc.constantFrom('living', 'yard') }),
      fc.record({ kind: fc.constant('leave' as const), who: fc.constantFrom('a', 'b', 'c', 'd'), room: fc.constantFrom('living', 'yard') }),
      fc.record({ kind: fc.constant('say' as const), who: fc.constantFrom('a', 'b', 'c', 'd'), room: fc.constantFrom('living', 'yard'), text: fc.constantFrom('안녕', '비밀이야', '배고파요', '하린씨 뭐해요') }),
    )
    fc.assert(
      fc.property(fc.array(op, { maxLength: 60 }), (ops) => {
        const s = setup()
        for (const o of ops) {
          const room = s.rooms.get(o.room)!
          const isIn = room.memberships.some((m) => m.participantId === o.who && m.leftSeq === null)
          if (o.kind === 'join' && !isIn) push(s, { type: 'MEMBER_JOINED', payload: { roomId: o.room, participantId: o.who }, visibility: { kind: 'room' } })
          if (o.kind === 'leave' && isIn) push(s, { type: 'MEMBER_LEFT', payload: { roomId: o.room, participantId: o.who }, visibility: { kind: 'room' } })
          if (o.kind === 'say' && isIn) push(s, { type: 'MESSAGE_SENT', actor: o.who, payload: { roomId: o.room, text: o.text, background: false }, visibility: { kind: 'room' } })
        }
        for (const [owner] of PEOPLE) {
          const view = new ObservationView(s, owner, defaultConfig)
          view.roomMessages('living', 50, 10_000)
          view.roomMessages('yard', 50, 10_000)
          view.observedSince(0, 10_000)
          for (const seq of view.touched) expect(canObserve(s, owner, s.events[seq - 1]!)).toBe(true)
        }
      }),
      { numRuns: 300 },
    )
  })
})
