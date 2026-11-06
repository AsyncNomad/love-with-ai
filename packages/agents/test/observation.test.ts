import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { defaultConfig } from '@heart/config'
import type { AnyEvent, CastParticipant, EventDraft } from '@heart/shared'
import { EVENT_SCHEMA_VERSION } from '@heart/shared'
import { applyEvent, canObserve, castHuman, createRunState, findMentions, type FoldOptions, type RunState } from '@heart/engine'
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

  it('lists only the rooms the owner actually shared, with the people in them (D37)', () => {
    const s = setup()
    push(s, { type: 'STAGE_STARTED', payload: { stage: 'D1_NIGHT_TALKS', simTime: 'D1 23:00' }, visibility: { kind: 'house' } })
    push(s, { type: 'ROOM_OPENED', payload: { roomId: 'terrace', kind: 'private', location: '테라스' }, visibility: { kind: 'server' } })
    for (const id of ['a', 'b']) push(s, { type: 'MEMBER_JOINED', payload: { roomId: 'terrace', participantId: id }, visibility: { kind: 'room' } })
    // 지금 있는 방은 지난 일이 아니라서 빠진다.
    expect(new ObservationView(s, 'a', defaultConfig).sharedHistory(1_000)).toEqual([])
    push(s, { type: 'ROOM_CLOSED', payload: { roomId: 'terrace' }, visibility: { kind: 'room' } })
    const a = new ObservationView(s, 'a', defaultConfig)
    expect(a.sharedHistory(1_000).map((l) => l.line)).toEqual(['오늘 심야 대화 · 테라스 · 박도현과 단둘이'])
    for (const seq of a.touched) expect(canObserve(s, 'a', s.events[seq - 1]!)).toBe(true)
    expect(new ObservationView(s, 'c', defaultConfig).sharedHistory(1_000)).toEqual([])
    expect(a.scheduleSoFar()).toBe('1일차(오늘): 심야 대화')
  })

  it('rejects a line that narrates the speaker in the third person (memory read aloud)', () => {
    const s = setup()
    for (const id of ['a', 'b']) push(s, { type: 'MEMBER_JOINED', payload: { roomId: 'living', participantId: id }, visibility: { kind: 'room' } })
    const ctx = { state: s, config: defaultConfig }
    const input = { speakerId: 'a', roomId: 'living', mode: 'reply' as const, isPrivate: false }
    const built = dialogueTask.build(input, ctx)
    const narrated = dialogueTask.finish({ action: 'speak', text: '박도현 씨는 이서윤과 여행 이야기를 나누며 가까워지는 것 같습니다.' }, input, ctx, built)
    expect('issues' in narrated && narrated.issues).toContain('self_third_person')
    const normal = dialogueTask.finish({ action: 'speak', text: '도현 씨는 여행 자주 가세요?' }, input, ctx, built)
    expect('value' in normal).toBe(true)
    const intro = dialogueTask.finish({ action: 'speak', text: '안녕하세요, 저 이서윤이에요.' }, input, ctx, built)
    expect('value' in intro).toBe(true)
  })

  it('salvages a reply by dropping only the offending sentence', () => {
    const s = setup()
    for (const id of ['a', 'b']) push(s, { type: 'MEMBER_JOINED', payload: { roomId: 'living', participantId: id }, visibility: { kind: 'room' } })
    const ctx = { state: s, config: defaultConfig }
    const input = { speakerId: 'a', roomId: 'living', mode: 'reply' as const, isPrivate: false }
    const built = dialogueTask.build(input, ctx)
    const mixed = dialogueTask.finish({ action: 'speak', text: '아, 그거 재밌겠어. 저도 한번 가 보고 싶어요.' }, input, ctx, built)
    expect('value' in mixed && mixed.value.text).toBe('저도 한번 가 보고 싶어요.')
    const allCasual = dialogueTask.finish({ action: 'speak', text: '그거 재밌겠다. 나도 가 볼래.' }, input, ctx, built)
    expect('issues' in allCasual && allCasual.issues).toContain('speech_level')
  })

  it('retry hints quote the rejected sentence without suggesting new wording', () => {
    const hint = dialogueTask.retryHint?.(['speech_level'], { action: 'speak', text: '반가워요. 나도 그거 좋아해.' }) ?? ''
    expect(hint).toContain('"나도 그거 좋아해."')
    expect(dialogueTask.retryHint?.(['repetition'], null)).not.toContain('걸린 문장')
  })

  it('detects an everyday topic echoed by many speakers without a word list', () => {
    const s = setup()
    for (const id of ['a', 'b', 'c', 'd']) push(s, { type: 'MEMBER_JOINED', payload: { roomId: 'living', participantId: id }, visibility: { kind: 'room' } })
    const lines: [string, string][] = [['a', '어제 잠이 잘 안 왔어요'], ['b', '저도 잠도 못 잤어요'], ['c', '잠이 안 오면 힘들죠'], ['d', '잠을 좀 더 자고 싶네요']]
    for (const [who, text] of lines) push(s, { type: 'MESSAGE_SENT', actor: who, payload: { roomId: 'living', text, background: false }, visibility: { kind: 'room' } })
    expect(new ObservationView(s, 'a', defaultConfig).echoedTopics('living')).toEqual(['잠'])
  })

  it('reports topics that keep coming up', () => {
    const s = setup()
    for (const id of ['a', 'b']) push(s, { type: 'MEMBER_JOINED', payload: { roomId: 'living', participantId: id }, visibility: { kind: 'room' } })
    for (const text of ['러닝 좋아해요', '저도 러닝해요', '주말에 러닝 같이 해요', '와인도 좋아요']) push(s, { type: 'MESSAGE_SENT', actor: 'b', payload: { roomId: 'living', text, background: false }, visibility: { kind: 'room' } })
    expect(new ObservationView(s, 'a', defaultConfig).wornTopics(['러닝', '와인'])).toEqual(['러닝'])
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
          view.sharedHistory(10_000)
          for (const seq of view.touched) expect(canObserve(s, owner, s.events[seq - 1]!)).toBe(true)
        }
      }),
      { numRuns: 300 },
    )
  })
})
