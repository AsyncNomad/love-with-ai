import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { firstImpressionRequests, humanTalkTargets, inviteCandidates, mutualPairs, packSlots, planNightTalks } from '../src'

const H = 'h'
const IDS = [H, 'f1', 'f2', 'f3', 'm1', 'm2']

describe('humanTalkTargets', () => {
  it('matches the spec example (game-rules §8.1)', () => {
    expect(humanTalkTargets(H, 'seoyun', ['seoyun', 'harin', 'minji']).sort()).toEqual(['harin', 'minji', 'seoyun'])
  })
  it('never includes the human and handles abstention', () => {
    expect(humanTalkTargets(H, null, [H, 'a'])).toEqual(['a'])
  })
})

describe('packSlots', () => {
  it('merges identical member sets and drops beyond the slot cap', () => {
    const plan = packSlots(
      [
        { members: ['a', 'b'], required: false },
        { members: ['b', 'a'], required: false },
        { members: ['a', 'c'], required: false },
        { members: ['a', 'd'], required: false },
      ],
      2,
    )
    expect(plan.slots.flat()).toHaveLength(2)
    expect(plan.dropped).toEqual([{ members: ['a', 'd'], required: false }])
  })
})

describe('first impression', () => {
  it('pairs mutual votes and groups accepted invites', () => {
    const ballots = new Map<string, string | null>([
      [H, 'f1'],
      ['f1', H],
      ['m1', 'f2'],
      ['m2', 'f2'],
      ['f2', null],
    ])
    expect(mutualPairs(ballots)).toEqual([['f1', 'h']])
    expect(inviteCandidates(ballots).get('f2')).toEqual(['m1', 'm2'])
    const reqs = firstImpressionRequests(ballots, new Map([['f2', ['m1']]]), H)
    expect(reqs[0]!.members).toContain(H)
    expect(reqs.map((r) => r.members)).toContainEqual(['f2', 'm1'])
  })
})

const ballotArb = fc
  .array(fc.constantFrom(...IDS, null), { minLength: IDS.length, maxLength: IDS.length })
  .map((targets) => new Map(IDS.map((id, i) => [id, targets[i] === id ? null : (targets[i] ?? null)])))

describe('planNightTalks (properties)', () => {
  it('schedules every human talk, never double-books, and respects AI caps', () => {
    fc.assert(
      fc.property(ballotArb, (ballots) => {
        const plan = planNightTalks(ballots, H, { perAi: 2, totalAiScenes: 6, minSlots: 2 })
        for (const slot of plan.slots) {
          const members = slot.flatMap((r) => r.members)
          expect(new Set(members).size).toBe(members.length)
        }
        const incoming = [...ballots].filter(([, t]) => t === H).map(([v]) => v)
        const expected = humanTalkTargets(H, ballots.get(H) ?? null, incoming)
        const humanRooms = plan.slots.flat().filter((r) => r.members.includes(H))
        expect(humanRooms.map((r) => r.members.find((m) => m !== H)).sort()).toEqual([...expected].sort())
        const aiRooms = plan.slots.flat().filter((r) => !r.members.includes(H))
        expect(aiRooms.length).toBeLessThanOrEqual(6)
        const perAi = new Map<string, number>()
        for (const r of aiRooms) for (const m of r.members) perAi.set(m, (perAi.get(m) ?? 0) + 1)
        for (const n of perAi.values()) expect(n).toBeLessThanOrEqual(2)
      }),
      { numRuns: 500 },
    )
  })

  it('prefers mutual AI pairs when the cap is tight', () => {
    const ballots = new Map<string, string | null>([
      ['f1', 'm1'],
      ['m1', 'f1'],
      ['f2', 'm1'],
      ['f3', 'm2'],
    ])
    const plan = planNightTalks(ballots, H, { perAi: 1, totalAiScenes: 1, minSlots: 1 })
    expect(plan.slots.flat().map((r) => r.members)).toEqual([['f1', 'm1']])
    expect(plan.dropped.length).toBe(2)
  })
})
