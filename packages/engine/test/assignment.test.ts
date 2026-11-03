import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { activityGroups, brunchGroups, createRng, firstImpressionRequests, humanTalkTargets, inviteCandidates, mutualPairs, packSlots, pairKey, planFinalDates, planNightTalks } from '../src'

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

describe('brunchGroups (game-rules §5.2)', () => {
  const members = [
    { id: 'h', gender: 'male' as const },
    { id: 'm1', gender: 'male' as const },
    { id: 'm2', gender: 'male' as const },
    { id: 'f1', gender: 'female' as const },
    { id: 'f2', gender: 'female' as const },
    { id: 'f3', gender: 'female' as const },
  ]
  it('splits into 2-3 person mixed groups and keeps night pairs apart', () => {
    fc.assert(
      fc.property(fc.string(), (seed) => {
        const avoid = new Set([pairKey('h', 'f1'), pairKey('m1', 'f2')])
        const groups = brunchGroups(members, avoid, createRng(seed), 3)
        expect(groups.flat().sort()).toEqual(members.map((m) => m.id).sort())
        for (const g of groups) {
          expect(g.length).toBeGreaterThanOrEqual(2)
          expect(g.length).toBeLessThanOrEqual(3)
          expect(!(g.includes('h') && g.includes('f1'))).toBe(true)
          expect(!(g.includes('m1') && g.includes('f2'))).toBe(true)
        }
      }),
      { numRuns: 100 },
    )
  })
  it('is deterministic for a seed', () => {
    expect(brunchGroups(members, new Set(), createRng('s'), 3)).toEqual(brunchGroups(members, new Set(), createRng('s'), 3))
  })
})

describe('activityGroups (game-rules §5.4)', () => {
  const acts = ['a', 'b', 'c', 'd']
  const order = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8']
  it('puts everyone in exactly one group of 2..max', () => {
    fc.assert(
      fc.property(fc.array(fc.tuple(fc.constantFrom(...acts), fc.constantFrom(...acts)), { minLength: 8, maxLength: 8 }), (choices) => {
        const picks = new Map(order.map((id, i) => [id, { first: choices[i]![0], second: choices[i]![1] }]))
        const groups = activityGroups(order, picks, 4)
        expect(groups.flatMap((g) => g.members).sort()).toEqual([...order].sort())
        for (const g of groups) expect(g.members.length).toBeGreaterThanOrEqual(2)
        for (const g of groups) expect(g.members.length).toBeLessThanOrEqual(5)
      }),
      { numRuns: 300 },
    )
  })
  it('splits an oversized group and moves a single to their second choice', () => {
    const picks = new Map([
      ['p1', { first: 'a', second: 'b' }],
      ['p2', { first: 'a', second: 'b' }],
      ['p3', { first: 'a', second: 'b' }],
      ['p4', { first: 'a', second: 'b' }],
      ['p5', { first: 'a', second: 'b' }],
      ['p6', { first: 'c', second: 'a' }],
    ])
    const groups = activityGroups(['p1', 'p2', 'p3', 'p4', 'p5', 'p6'], picks, 4)
    expect(groups.map((g) => g.members.length).sort()).toEqual([3, 3])
    expect(groups.every((g) => g.activityId === 'a')).toBe(true)
  })
})

describe('planFinalDates (game-rules §8.4)', () => {
  it('always schedules the human pick and never double-books', () => {
    fc.assert(
      fc.property(ballotArb, (ballots) => {
        const plan = planFinalDates(ballots, H, 2)
        for (const slot of plan.slots) {
          const members = slot.flatMap((r) => r.members)
          expect(new Set(members).size).toBe(members.length)
        }
        const pick = ballots.get(H) ?? null
        if (pick !== null) expect(plan.slots.flat().some((r) => r.members.includes(H) && r.members.includes(pick))).toBe(true)
        expect(plan.slots.length).toBeLessThanOrEqual(2)
      }),
      { numRuns: 500 },
    )
  })
})
