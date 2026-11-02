import { describe, expect, it } from 'vitest'
import { defaultConfig } from '@signal/config'
import type { CastParticipant } from '@signal/shared'
import {
  aliasesFor,
  castHuman,
  createRng,
  findMentions,
  oppositeGenderRule,
  pickSpeakers,
  scaleDeltas,
  validateBallot,
  type SpeakerFeatures,
} from '../src'
import { StateBuilder } from './helpers'

describe('rng', () => {
  it('forks independent deterministic streams', () => {
    const a = createRng('x').fork('names')
    const b = createRng('x').fork('names')
    expect([a.next(), a.next()]).toEqual([b.next(), b.next()])
    expect(createRng('x').fork('ages').next()).not.toBe(createRng('x').fork('names').next())
  })
})

describe('aliases', () => {
  it('builds Korean address forms with batchim rules', () => {
    expect(aliasesFor('이서윤')).toEqual(expect.arrayContaining(['서윤', '서윤씨', '서윤아', '서윤이']))
    expect(aliasesFor('정하린')).toContain('하린아')
    expect(aliasesFor('김세아')).toContain('세아야')
  })
  it('keeps non-Korean nicknames whole', () => {
    expect(aliasesFor('Jay')).toContain('Jay')
    expect(findMentions('Jay씨 뭐 해요?', [{ id: 'j', name: 'Jay' }, { id: 'a', name: '이서윤' }])).toEqual(['j'])
    expect(findMentions('okay', [{ id: 'j', name: 'Jay' }])).toEqual([])
  })
  it('finds mentions by given name', () => {
    expect(findMentions('하린씨는 뭐 좋아해요?', [{ id: 'h', name: '정하린' }, { id: 'd', name: '박도현' }])).toEqual(['h'])
  })
})

function p(id: string, gender: 'male' | 'female'): CastParticipant {
  return { ...castHuman({ name: `김${id}${id}`, gender, age: 25, region: '서울', occupation: 'x', personality: '', interests: [] }), id, isHuman: false }
}

describe('validateBallot', () => {
  const b = new StateBuilder()
  for (const [id, g] of [
    ['m', 'male'],
    ['f', 'female'],
    ['g', 'female'],
    ['late', 'female'],
  ] as const) {
    b.push({ type: 'PARTICIPANT_CAST', payload: { participant: p(id, g) }, visibility: { kind: 'server' } })
    if (id !== 'late') b.push({ type: 'HOUSE_ENTERED', payload: { participantId: id }, visibility: { kind: 'house' } })
  }
  b.push({ type: 'VOTE_OPENED', payload: { voteId: 'v1', kind: 'night' }, visibility: { kind: 'house' } })

  it('accepts eligible targets and abstention', () => {
    expect(validateBallot(b.state, oppositeGenderRule, 'v1', 'm', 'f')).toBeNull()
    expect(validateBallot(b.state, oppositeGenderRule, 'v1', 'm', null)).toBeNull()
  })
  it('rejects self, same gender, not-yet-entered and unknown votes', () => {
    expect(validateBallot(b.state, oppositeGenderRule, 'v1', 'm', 'm')).toBe('self_vote')
    expect(validateBallot(b.state, oppositeGenderRule, 'v1', 'f', 'g')).toBe('ineligible_target')
    expect(validateBallot(b.state, oppositeGenderRule, 'v1', 'm', 'late')).toBe('ineligible_target')
    expect(validateBallot(b.state, oppositeGenderRule, 'nope', 'm', 'f')).toBe('vote_not_found')
  })
  it('rejects duplicates and closed votes', () => {
    b.push({ type: 'VOTE_COMMITTED', payload: { voteId: 'v1', voterId: 'm', targetId: 'f', reason: null, auto: false }, visibility: { kind: 'participants', ids: ['m'] } })
    expect(validateBallot(b.state, oppositeGenderRule, 'v1', 'm', 'g')).toBe('already_voted')
    b.push({ type: 'VOTE_CLOSED', payload: { voteId: 'v1' }, visibility: { kind: 'house' } })
    expect(validateBallot(b.state, oppositeGenderRule, 'v1', 'f', 'm')).toBe('vote_closed')
  })
})

describe('pickSpeakers', () => {
  const base = (id: string, over: Partial<SpeakerFeatures> = {}): SpeakerFeatures => ({
    id,
    mentioned: false,
    topicMatch: false,
    participatedRecently: false,
    extraversion: 50,
    interestInSpeaker: 50,
    recentCount: 0,
    consecutive: 0,
    quiet: false,
    ...over,
  })
  const w = defaultConfig.scheduler.weights
  it('always puts mentioned candidates first', () => {
    const out = pickSpeakers([base('a'), base('b', { mentioned: true }), base('c')], 2, createRng('s'), w, 2)
    expect(out[0]).toBe('b')
    expect(out).toHaveLength(2)
  })
  it('excludes candidates who hit the consecutive limit', () => {
    expect(pickSpeakers([base('a', { consecutive: 2, mentioned: true })], 1, createRng('s'), w, 2)).toEqual([])
  })
})

describe('scaleDeltas', () => {
  it('converts units and caps them', () => {
    const cfg = defaultConfig.relationship
    expect(scaleDeltas({ interest: 2, comfort: -2, trust: 0, curiosity: 5 }, false, cfg)).toEqual({ interest: 8, comfort: -8, trust: 0, curiosity: 8 })
    expect(scaleDeltas({ interest: 2, comfort: 1, trust: 0, curiosity: 0 }, true, cfg)).toEqual({ interest: 16, comfort: 8, trust: 0, curiosity: 0 })
  })
})
