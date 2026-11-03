import type { CastParticipant, CastingPools, Gender, HumanProfile, OccupationEntry, Traits } from '@heart/shared'
import { TRAIT_AXES, oppositeGender } from '@heart/shared'
import { givenName } from './aliases'
import type { Rng } from './rng'

/**
 * design.md §8.1의 1~5단계: 서버가 시드로 정하는 구조적 제약.
 * LLM은 여기서 정한 값을 바꾸지 못한다(배경·말투 서술만 덧붙인다).
 */

export interface CastingInput {
  human: HumanProfile
  originalOpposite: number
  originalSame: number
  catfishPerGender: number
  ageSpread: number
  minAge: number
}

export const HUMAN_ID = 'p_00'

interface Slot {
  gender: Gender
  isCatfish: boolean
}

export function castParticipants(input: CastingInput, pools: CastingPools, rng: Rng): CastParticipant[] {
  const slots = buildSlots(input)
  const ages = pickAges(slots.length, input, rng.fork('ages'))
  const traits = diverseTraits(slots.length, rng.fork('traits'))
  const names = pickNames(slots, input.human.name, pools, rng.fork('names'))
  const occupations = pickOccupations(ages, pools.occupations, rng.fork('occupations'))
  const appearance = pickAppearance(slots, pools, rng.fork('appearance'))
  const interestRng = rng.fork('interests')
  const misc = rng.fork('misc')
  const entryOrder = arrivalOrder(slots, input.human.gender)

  return slots.map((slot, i) => {
    const t = traits[i] as Traits
    return {
      id: `p_${String(i + 1).padStart(2, '0')}`,
      isHuman: false,
      isCatfish: slot.isCatfish,
      gender: slot.gender,
      name: names[i] as string,
      age: ages[i] as number,
      occupation: occupations[i] as string,
      region: misc.pick(pools.regions),
      entryOrder: entryOrder[i] as number,
      interests: interestRng.shuffle(pools.interests).slice(0, 3),
      traits: t,
      prefs: randomTraits(misc),
      dealbreaker: { axis: misc.pick(TRAIT_AXES), direction: misc.chance(0.5) ? 'high' : 'low' },
      speech: {
        length: t.extraversion > 65 ? 'medium' : misc.chance(0.3) ? 'medium' : 'short',
        // 웃음 표현은 유머가 많은 인물만 쓰도록 분포를 낮췄다(실측: 대부분이 ㅋㅋ를 남발했다).
        laughter: round2(Math.max(0, Math.min(1, (t.humor / 100) * 0.7 + misc.next() * 0.3 - 0.15))),
        emoji: round2(misc.next() * (t.expressiveness / 100)),
        questionTendency: round2(0.2 + (t.extraversion / 100) * 0.4 + misc.next() * 0.2),
        humorStyle: misc.pick(pools.humorStyles),
        temperatureOffset: round2((misc.next() - 0.5) * 0.2),
      },
      appearance: appearance[i] as CastParticipant['appearance'],
    }
  })
}

export function castHuman(human: HumanProfile): CastParticipant {
  const neutral: Traits = { extraversion: 50, openness: 50, assertiveness: 50, expressiveness: 50, humor: 50 }
  return {
    id: HUMAN_ID,
    isHuman: true,
    isCatfish: false,
    gender: human.gender,
    name: human.name,
    age: human.age,
    occupation: human.occupation,
    region: human.region,
    entryOrder: 0,
    interests: human.interests,
    traits: neutral,
    prefs: neutral,
    dealbreaker: { axis: 'extraversion', direction: 'high' },
    speech: { length: 'short', laughter: 0, emoji: 0, questionTendency: 0, humorStyle: '', temperatureOffset: 0 },
    appearance: { hair: '', outfit: '', expression: '', background: '', vibe: '' },
    humanPersonality: human.personality,
  }
}

function buildSlots(input: CastingInput): Slot[] {
  const opp = oppositeGender(input.human.gender)
  const slots: Slot[] = []
  for (let i = 0; i < input.originalOpposite; i++) slots.push({ gender: opp, isCatfish: false })
  for (let i = 0; i < input.originalSame; i++) slots.push({ gender: input.human.gender, isCatfish: false })
  for (let i = 0; i < input.catfishPerGender; i++) {
    slots.push({ gender: 'male', isCatfish: true })
    slots.push({ gender: 'female', isCatfish: true })
  }
  return slots
}

/** 원래 참가자는 사람과 다른 성별부터 번갈아 입장한다(game-rules.md §4.1). 메기는 0(별도 단계). */
function arrivalOrder(slots: Slot[], humanGender: Gender): number[] {
  const opp = slots.map((s, i) => ({ s, i })).filter((x) => !x.s.isCatfish && x.s.gender !== humanGender)
  const same = slots.map((s, i) => ({ s, i })).filter((x) => !x.s.isCatfish && x.s.gender === humanGender)
  const order = new Array<number>(slots.length).fill(0)
  let n = 1
  while (opp.length > 0 || same.length > 0) {
    const a = opp.shift()
    if (a) order[a.i] = n++
    const b = same.shift()
    if (b) order[b.i] = n++
  }
  return order
}

function pickAges(count: number, input: CastingInput, rng: Rng): number[] {
  const lo = Math.max(input.minAge, input.human.age - input.ageSpread)
  const hi = Math.max(lo, input.human.age + input.ageSpread)
  const used = new Map<number, number>()
  const out: number[] = []
  for (let i = 0; i < count; i++) {
    const options = range(lo, hi).filter((a) => (used.get(a) ?? 0) < 2)
    const age = options.length > 0 ? rng.pick(options) : rng.int(lo, hi)
    used.set(age, (used.get(age) ?? 0) + 1)
    out.push(age)
  }
  return out
}

/** 후보를 많이 뽑고 최원점 샘플링으로 서로 먼 성향 조합을 고른다(design.md §8.1-2). */
export function diverseTraits(count: number, rng: Rng, candidates = 48): Traits[] {
  const pool = Array.from({ length: candidates }, () => randomTraits(rng))
  const chosen: Traits[] = [pool.splice(rng.int(0, pool.length - 1), 1)[0] as Traits]
  while (chosen.length < count && pool.length > 0) {
    let best = 0
    let bestDist = -1
    pool.forEach((c, i) => {
      const d = Math.min(...chosen.map((x) => traitDistance(x, c)))
      if (d > bestDist) {
        bestDist = d
        best = i
      }
    })
    chosen.push(pool.splice(best, 1)[0] as Traits)
  }
  return rng.shuffle(chosen)
}

export function traitDistance(a: Traits, b: Traits): number {
  return Math.sqrt(TRAIT_AXES.reduce((s, k) => s + (a[k] - b[k]) ** 2, 0))
}

function randomTraits(rng: Rng): Traits {
  const v = (): number => rng.int(10, 90)
  return { extraversion: v(), openness: v(), assertiveness: v(), expressiveness: v(), humor: v() }
}

/**
 * 이름은 서로 겹치지 않을 뿐 아니라, 어떤 전체 이름도 다른 사람의 이름(2글자)을 품지 않아야 한다.
 * 예: "정우진"은 "최정우"의 "정우"를 품는다. 이러면 호칭 지목과 canary 검사가 모호해진다.
 */
function pickNames(slots: Slot[], humanName: string, pools: CastingPools, rng: Rng): string[] {
  const fulls: string[] = [humanName]
  const givens: string[] = [givenName(humanName)]
  return slots.map((slot) => {
    for (let attempt = 0; attempt < 500; attempt++) {
      const given = rng.pick(pools.givenNames[slot.gender])
      const full = rng.pick(pools.surnames) + given
      const clashes = givens.some((g) => full.includes(g)) || fulls.some((f) => f.includes(given))
      if (clashes) continue
      fulls.push(full)
      givens.push(given)
      return full
    }
    throw new Error('name pool exhausted')
  })
}


function pickOccupations(ages: number[], entries: OccupationEntry[], rng: Rng): string[] {
  const usedTitle = new Set<string>()
  const categoryCount = new Map<string, number>()
  return ages.map((age) => {
    const fits = entries.filter((e) => age >= e.minAge && (e.maxAge === undefined || age <= e.maxAge))
    const fresh = fits.filter((e) => !usedTitle.has(e.title) && (categoryCount.get(e.category) ?? 0) < 2)
    const entry = rng.pick(fresh.length > 0 ? fresh : fits.length > 0 ? fits : entries)
    usedTitle.add(entry.title)
    categoryCount.set(entry.category, (categoryCount.get(entry.category) ?? 0) + 1)
    return entry.title
  })
}

function pickAppearance(slots: Slot[], pools: CastingPools, rng: Rng): CastParticipant['appearance'][] {
  const a = pools.appearance
  const hair = { female: rng.shuffle(a.hair.female), male: rng.shuffle(a.hair.male) }
  const outfit = { female: rng.shuffle(a.outfit.female), male: rng.shuffle(a.outfit.male) }
  const counters = { female: 0, male: 0 }
  return slots.map((slot) => {
    const i = counters[slot.gender]++
    const hairs = hair[slot.gender]
    const outfits = outfit[slot.gender]
    return {
      hair: hairs[i % hairs.length] as string,
      outfit: outfits[i % outfits.length] as string,
      expression: rng.pick(a.expression),
      background: rng.pick(a.background),
      vibe: rng.pick(a.vibe),
    }
  })
}

function range(lo: number, hi: number): number[] {
  return Array.from({ length: hi - lo + 1 }, (_, i) => lo + i)
}

function round2(v: number): number {
  return Math.round(v * 100) / 100
}
