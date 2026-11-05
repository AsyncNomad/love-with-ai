import { describe, expect, it } from 'vitest'
import { defaultConfig } from '@heart/config'
import type { CastParticipant } from '@heart/shared'
import { ageRelation, answersFor, castHuman, proposableKind, proposalKind, speechChanges, speechLevelOf } from '../src'
import { StateBuilder } from './helpers'

const cfg = defaultConfig.speech
const rel = defaultConfig.relationship

function setup(ages: Record<string, number>, discloseAges: boolean): StateBuilder {
  const b = new StateBuilder()
  for (const [id, age] of Object.entries(ages)) {
    const cast: CastParticipant = { ...castHuman({ name: `참가${id}`, gender: id === 'a' ? 'male' : 'female', age, region: '서울', occupation: '대학생', personality: '', interests: [] }), id, isHuman: false }
    b.push({ type: 'PARTICIPANT_CAST', payload: { participant: cast }, visibility: { kind: 'server' } })
  }
  for (const id of Object.keys(ages)) {
    b.push({ type: 'HOUSE_ENTERED', payload: { participantId: id }, visibility: { kind: 'house' } })
    b.push({ type: 'PROFILE_DISCLOSED', payload: { subjectId: id, fields: { name: `참가${id}`, ...(discloseAges ? { age: ages[id] } : {}) } }, visibility: { kind: 'house' } })
  }
  b.push({ type: 'ROOM_OPENED', payload: { roomId: 'yard', kind: 'private', location: '마당' }, visibility: { kind: 'server' } })
  for (const id of Object.keys(ages)) b.push({ type: 'MEMBER_JOINED', payload: { roomId: 'yard', participantId: id }, visibility: { kind: 'room' } })
  return b
}

/** 두 사람이 1:1로 n마디 나누고, a가 b를 편하게 느끼게 만든다. */
function getClose(b: StateBuilder, n: number): void {
  for (let i = 0; i < n; i++) {
    b.push({ type: 'MESSAGE_SENT', actor: i % 2 ? 'b' : 'a', payload: { roomId: 'yard', text: `얘기 ${i}`, background: false }, visibility: { kind: 'room' } })
  }
  b.push({ type: 'RELATIONSHIP_UPDATED', payload: { sourceId: 'a', targetId: 'b', deltas: { interest: 0, comfort: 15, trust: 0, curiosity: 0 }, significant: false, reason: '', evidenceSeqs: [] }, visibility: { kind: 'participants', ids: ['a'] } })
}

describe('speech etiquette (game-rules §11)', () => {
  it('picks the proposal kind from the age gap', () => {
    expect(proposalKind(27, 27, cfg)).toBe('mutual')
    expect(proposalKind(29, 27, cfg)).toBe('mutual')
    expect(proposalKind(32, 27, cfg)).toBe('ask')
    expect(proposalKind(25, 27, cfg)).toBe('grant')
  })

  it('maps answers to directed changes', () => {
    expect(speechChanges('a', 'b', 'mutual', 'accept')).toEqual([{ fromId: 'a', toId: 'b' }, { fromId: 'b', toId: 'a' }])
    expect(speechChanges('a', 'b', 'mutual', 'you_only')).toEqual([{ fromId: 'a', toId: 'b' }])
    expect(speechChanges('a', 'b', 'grant', 'accept')).toEqual([{ fromId: 'b', toId: 'a' }])
    expect(speechChanges('a', 'b', 'ask', 'decline')).toEqual([])
    expect(answersFor('grant')).not.toContain('you_only')
  })

  it('requires known age, enough talk and comfort, and only one proposal per pair', () => {
    const unknownAge = setup({ a: 27, b: 27 }, false)
    getClose(unknownAge, 30)
    expect(proposableKind(unknownAge.state, 'a', 'b', cfg, rel)).toBeNull()

    const strangers = setup({ a: 27, b: 27 }, true)
    expect(proposableKind(strangers.state, 'a', 'b', cfg, rel)).toBeNull()

    const close = setup({ a: 28, b: 27 }, true)
    getClose(close, 30)
    expect(proposableKind(close.state, 'a', 'b', cfg, rel)).toBe('mutual')
    close.push({ type: 'SPEECH_PROPOSED', payload: { proposalId: 'p1', roomId: 'yard', fromId: 'a', toId: 'b', kind: 'mutual' }, visibility: { kind: 'room' } })
    expect(proposableKind(close.state, 'a', 'b', cfg, rel)).toBeNull()
    expect(proposableKind(close.state, 'b', 'a', cfg, rel)).toBeNull()
  })

  it('keeps speech levels directed', () => {
    const b = setup({ a: 30, b: 26 }, true)
    b.push({ type: 'SPEECH_LEVEL_SET', payload: { fromId: 'a', toId: 'b', level: 'casual' }, visibility: { kind: 'participants', ids: ['a', 'b'] } })
    expect(speechLevelOf(b.state, 'a', 'b')).toBe('casual')
    expect(speechLevelOf(b.state, 'b', 'a')).toBe('polite')
  })

  it('describes the age relation as a fact', () => {
    expect(ageRelation(27, 29)).toBe('나보다 2살 많음')
    expect(ageRelation(27, 27)).toBe('나와 동갑')
    expect(ageRelation(27, null)).toBeNull()
  })
})
