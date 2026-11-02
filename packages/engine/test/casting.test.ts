import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { defaultConfig } from '@signal/config'
import type { HumanProfile } from '@signal/shared'
import { castParticipants, createRng, diverseTraits, givenName, traitDistance } from '../src'

const human = (over: Partial<HumanProfile> = {}): HumanProfile => ({
  name: '김지수',
  gender: 'male',
  age: 27,
  region: '서울',
  occupation: '개발자',
  personality: '',
  interests: [],
  ...over,
})

const input = (h: HumanProfile) => ({
  human: h,
  originalOpposite: 3,
  originalSame: 2,
  catfishPerGender: 1,
  ageSpread: 3,
  minAge: 19,
})

describe('castParticipants', () => {
  it('is deterministic for the same seed', () => {
    const a = castParticipants(input(human()), defaultConfig.pools, createRng('seed-1'))
    const b = castParticipants(input(human()), defaultConfig.pools, createRng('seed-1'))
    expect(a).toEqual(b)
  })

  it('builds 3 opposite + 2 same + one catfish per gender for a male human', () => {
    const cast = castParticipants(input(human()), defaultConfig.pools, createRng('s'))
    const originals = cast.filter((c) => !c.isCatfish)
    expect(originals.filter((c) => c.gender === 'female')).toHaveLength(3)
    expect(originals.filter((c) => c.gender === 'male')).toHaveLength(2)
    expect(cast.filter((c) => c.isCatfish).map((c) => c.gender).sort()).toEqual(['female', 'male'])
  })

  it('alternates arrival starting with the opposite gender', () => {
    const cast = castParticipants(input(human({ gender: 'female' })), defaultConfig.pools, createRng('s2'))
    const order = cast
      .filter((c) => !c.isCatfish)
      .sort((a, b) => a.entryOrder - b.entryOrder)
      .map((c) => c.gender)
    expect(order).toEqual(['male', 'female', 'male', 'female', 'male'])
    expect(cast.filter((c) => c.isCatfish).every((c) => c.entryOrder === 0)).toBe(true)
  })

  it('keeps structural invariants for any seed and human age', () => {
    fc.assert(
      fc.property(fc.string(), fc.integer({ min: 19, max: 45 }), fc.constantFrom('male', 'female'), (seed, age, gender) => {
        const h = human({ age, gender: gender as HumanProfile['gender'] })
        const cast = castParticipants(input(h), defaultConfig.pools, createRng(seed))
        const names = cast.map((c) => c.name)
        expect(new Set(names).size).toBe(names.length)
        expect(new Set(names.map((n) => n.slice(1))).size).toBe(names.length)
        const all = [h.name, ...names]
        for (const a of all) for (const b of all) if (a !== b) expect(a.includes(givenName(b))).toBe(false)
        for (const c of cast) {
          expect(c.age).toBeGreaterThanOrEqual(19)
          expect(Math.abs(c.age - age)).toBeLessThanOrEqual(Math.max(3, 19 - age + 3))
          const occ = defaultConfig.pools.occupations.find((o) => o.title === c.occupation)
          expect(occ).toBeDefined()
        }
        const ageCounts = new Map<number, number>()
        for (const c of cast) ageCounts.set(c.age, (ageCounts.get(c.age) ?? 0) + 1)
        expect(Math.max(...ageCounts.values())).toBeLessThanOrEqual(2)
      }),
      { numRuns: 200 },
    )
  })
})

describe('diverseTraits', () => {
  it('spreads personalities further apart than random picks on average', () => {
    const rng = createRng('div')
    const chosen = diverseTraits(7, rng)
    let min = Infinity
    for (let i = 0; i < chosen.length; i++)
      for (let j = i + 1; j < chosen.length; j++) min = Math.min(min, traitDistance(chosen[i]!, chosen[j]!))
    expect(min).toBeGreaterThan(25)
  })
})
