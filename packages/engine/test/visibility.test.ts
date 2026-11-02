import { describe, expect, it } from 'vitest'
import type { CastParticipant } from '@heart/shared'
import { canObserve, castHuman, knownNameIds, knownProfile } from '../src'
import { StateBuilder } from './helpers'

function cast(id: string, name: string, gender: 'male' | 'female' = 'female'): CastParticipant {
  return { ...castHuman({ name, gender, age: 25, region: '서울', occupation: '대학생', personality: '', interests: [] }), id, isHuman: false }
}

function setup() {
  const b = new StateBuilder()
  for (const [id, name] of [
    ['a', '이서윤'],
    ['b', '박도현'],
    ['c', '최하린'],
  ] as const) {
    b.push({ type: 'PARTICIPANT_CAST', payload: { participant: cast(id, name) }, visibility: { kind: 'participants', ids: [id] } })
  }
  b.push({ type: 'ROOM_OPENED', payload: { roomId: 'living', kind: 'living', location: '거실' }, visibility: { kind: 'server' } })
  return b
}

describe('canObserve', () => {
  it('hides room messages sent before a member joined', () => {
    const b = setup()
    b.push({ type: 'MEMBER_JOINED', payload: { roomId: 'living', participantId: 'a' }, visibility: { kind: 'room' } })
    const early = b.push({ type: 'MESSAGE_SENT', actor: 'a', payload: { roomId: 'living', text: '안녕', background: false }, visibility: { kind: 'room' } })
    const join = b.push({ type: 'MEMBER_JOINED', payload: { roomId: 'living', participantId: 'b' }, visibility: { kind: 'room' } })
    const late = b.push({ type: 'MESSAGE_SENT', actor: 'a', payload: { roomId: 'living', text: '반가워요', background: false }, visibility: { kind: 'room' } })
    expect(canObserve(b.state, 'b', early)).toBe(false)
    expect(canObserve(b.state, 'b', join)).toBe(true)
    expect(canObserve(b.state, 'b', late)).toBe(true)
    expect(canObserve(b.state, 'c', late)).toBe(false)
  })

  it('does not reveal what was said while a member was away, even after rejoining', () => {
    const b = setup()
    b.push({ type: 'MEMBER_JOINED', payload: { roomId: 'living', participantId: 'a' }, visibility: { kind: 'room' } })
    b.push({ type: 'MEMBER_JOINED', payload: { roomId: 'living', participantId: 'b' }, visibility: { kind: 'room' } })
    const leave = b.push({ type: 'MEMBER_LEFT', payload: { roomId: 'living', participantId: 'b' }, visibility: { kind: 'room' } })
    const away = b.push({ type: 'MESSAGE_SENT', actor: 'a', payload: { roomId: 'living', text: '비밀', background: false }, visibility: { kind: 'room' } })
    b.push({ type: 'MEMBER_JOINED', payload: { roomId: 'living', participantId: 'b' }, visibility: { kind: 'room' } })
    expect(canObserve(b.state, 'b', leave)).toBe(true)
    expect(canObserve(b.state, 'b', away)).toBe(false)
  })

  it('limits participants-visibility and server events', () => {
    const b = setup()
    const own = b.state.events[0]!
    expect(canObserve(b.state, 'a', own)).toBe(true)
    expect(canObserve(b.state, 'b', own)).toBe(false)
    const room = b.state.events.find((e) => e.type === 'ROOM_OPENED')!
    expect(canObserve(b.state, 'a', room)).toBe(false)
  })

  it('house events reach only those already in the house', () => {
    const b = setup()
    b.push({ type: 'HOUSE_ENTERED', payload: { participantId: 'a' }, visibility: { kind: 'house' } })
    const name = b.push({ type: 'PROFILE_DISCLOSED', payload: { subjectId: 'a', fields: { name: '이서윤' } }, visibility: { kind: 'house' } })
    b.push({ type: 'HOUSE_ENTERED', payload: { participantId: 'b' }, visibility: { kind: 'house' } })
    const intro = b.push({ type: 'PROFILE_DISCLOSED', payload: { subjectId: 'b', fields: { name: '박도현' } }, visibility: { kind: 'house' } })
    expect(canObserve(b.state, 'b', name)).toBe(false)
    expect(canObserve(b.state, 'a', intro)).toBe(true)
    expect(knownNameIds(b.state, 'b')).toEqual(new Set(['b']))
    expect(knownNameIds(b.state, 'a')).toEqual(new Set(['a', 'b']))
    expect(knownProfile(b.state, 'a', 'b').name).toBe('박도현')
    expect(knownProfile(b.state, 'b', 'a').name).toBeNull()
    expect(knownProfile(b.state, 'c', 'c').occupation).toBe('대학생')
  })
})
