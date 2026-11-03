import type { Gender, ParticipantId } from '@heart/shared'
import type { Rng } from './rng'
import { pairKey } from './state'
import { mutualPairs } from './votes'

/** game-rules.md §8 방 배정. 모두 순수 함수다. */

export interface TalkRequest {
  members: ParticipantId[]
  /** 필수 대화는 슬롯 상한을 넘겨서라도 배정한다(§8.1). */
  required: boolean
}

export interface SlotPlan {
  slots: TalkRequest[][]
  dropped: TalkRequest[]
}

type Ballots = ReadonlyMap<ParticipantId, ParticipantId | null>

/** §8.1: 내가 고른 사람 + 나를 고른 모든 사람. 같은 사람은 한 번만. */
export function humanTalkTargets(
  humanId: ParticipantId,
  humanChoice: ParticipantId | null,
  incoming: readonly ParticipantId[],
): ParticipantId[] {
  const targets = new Set<ParticipantId>()
  if (humanChoice !== null) targets.add(humanChoice)
  for (const id of incoming) targets.add(id)
  targets.delete(humanId)
  return [...targets]
}

/**
 * 요청을 순서대로 슬롯에 탐욕적으로 넣는다. 한 참가자는 한 슬롯에 한 방에만 있다.
 * 같은 멤버 구성의 요청은 하나로 합친다.
 */
export function packSlots(requests: readonly TalkRequest[], maxSlots: number, initial: TalkRequest[][] = []): SlotPlan {
  const slots: TalkRequest[][] = initial.map((s) => [...s])
  const dropped: TalkRequest[] = []
  const seen = new Set<string>(slots.flat().map((r) => [...r.members].sort().join('|')))
  for (const req of requests) {
    const key = [...req.members].sort().join('|')
    if (seen.has(key)) continue
    seen.add(key)
    const busyIn = (slot: TalkRequest[]): boolean => slot.some((r) => r.members.some((m) => req.members.includes(m)))
    const idx = slots.findIndex((s) => !busyIn(s))
    if (idx >= 0) {
      ;(slots[idx] as TalkRequest[]).push(req)
    } else if (slots.length < maxSlots || req.required) {
      slots.push([req])
    } else {
      dropped.push(req)
    }
  }
  return { slots, dropped }
}

/** §8.2-2: 대상 T에게 투표했지만 서로 고르지 않은 사람들(초대 후보). */
export function inviteCandidates(ballots: Ballots): Map<ParticipantId, ParticipantId[]> {
  const out = new Map<ParticipantId, ParticipantId[]>()
  for (const [voter, target] of ballots) {
    if (target === null) continue
    if (ballots.get(target) === voter) continue
    out.set(target, [...(out.get(target) ?? []), voter])
  }
  return out
}

/** §8.2: 서로 고른 쌍 → 1:1, 수락된 초대 → 최대 3인 그룹. 사람이 있는 방을 앞에 둔다. */
export function firstImpressionRequests(
  ballots: Ballots,
  accepted: ReadonlyMap<ParticipantId, readonly ParticipantId[]>,
  humanId: ParticipantId,
): TalkRequest[] {
  const reqs: TalkRequest[] = mutualPairs(new Map(ballots)).map(([a, b]) => ({ members: [a, b], required: false }))
  for (const [target, voters] of accepted) {
    if (voters.length > 0) reqs.push({ members: [target, ...voters], required: false })
  }
  return sortHumanFirst(reqs, humanId)
}

export interface NightPlanOptions {
  perAi: number
  totalAiScenes: number
  minSlots: number
}

/**
 * 심야 대화(§8.1, §8.3). 사람의 필수 대화를 슬롯마다 하나씩 먼저 넣고,
 * AI끼리의 대화를 상한 안에서 같은 슬롯들에 채운다.
 */
export function planNightTalks(ballots: Ballots, humanId: ParticipantId, opts: NightPlanOptions): SlotPlan {
  const incoming = [...ballots].filter(([, t]) => t === humanId).map(([v]) => v)
  const humanReqs = humanTalkTargets(humanId, ballots.get(humanId) ?? null, incoming).map((t) => ({
    members: [humanId, t],
    required: true,
  }))
  const humanPlan = packSlots(humanReqs, 0)
  const slotCount = Math.max(humanPlan.slots.length, opts.minSlots)
  const aiReqs = selectAiPairs(ballots, humanId, opts)
  const plan = packSlots(aiReqs.selected, slotCount, humanPlan.slots)
  return { slots: plan.slots, dropped: [...aiReqs.dropped, ...plan.dropped] }
}

function selectAiPairs(
  ballots: Ballots,
  humanId: ParticipantId,
  opts: NightPlanOptions,
): { selected: TalkRequest[]; dropped: TalkRequest[] } {
  const candidates: { a: ParticipantId; b: ParticipantId; mutual: boolean; order: number }[] = []
  const seen = new Set<string>()
  let order = 0
  for (const [voter, target] of ballots) {
    if (target === null || voter === humanId || target === humanId) continue
    const key = pairKey(voter, target)
    if (seen.has(key)) continue
    seen.add(key)
    candidates.push({ a: voter, b: target, mutual: ballots.get(target) === voter, order: order++ })
  }
  const count = new Map<ParticipantId, number>()
  const c = (id: ParticipantId): number => count.get(id) ?? 0
  const selected: TalkRequest[] = []
  const remaining = [...candidates]
  while (remaining.length > 0 && selected.length < opts.totalAiScenes) {
    const eligible = remaining.filter((x) => c(x.a) < opts.perAi && c(x.b) < opts.perAi)
    if (eligible.length === 0) break
    eligible.sort((x, y) => Number(y.mutual) - Number(x.mutual) || c(x.a) + c(x.b) - (c(y.a) + c(y.b)) || x.order - y.order)
    const pick = eligible[0] as (typeof eligible)[number]
    remaining.splice(remaining.indexOf(pick), 1)
    selected.push({ members: [pick.a, pick.b], required: false })
    count.set(pick.a, c(pick.a) + 1)
    count.set(pick.b, c(pick.b) + 1)
  }
  return { selected, dropped: remaining.map((x) => ({ members: [x.a, x.b], required: false })) }
}

function sortHumanFirst(reqs: TalkRequest[], humanId: ParticipantId): TalkRequest[] {
  return [...reqs].sort((x, y) => Number(y.members.includes(humanId)) - Number(x.members.includes(humanId)))
}

/** 슬롯에서 어떤 방에도 없는 참가자(거실에 남는다). */
export function unassignedIn(slot: readonly TalkRequest[], all: readonly ParticipantId[]): ParticipantId[] {
  const busy = new Set(slot.flatMap((r) => r.members))
  return all.filter((id) => !busy.has(id))
}

/** 크기 n을 상한 max 이하의 그룹 g개로 최대한 고르게 나눈다(예: 7, 3 → [3, 2, 2]). */
function evenSizes(n: number, max: number): number[] {
  const g = Math.max(1, Math.ceil(n / max))
  return Array.from({ length: g }, (_, i) => Math.floor(n / g) + (i < n % g ? 1 : 0))
}

export interface BrunchMember {
  id: ParticipantId
  gender: Gender
}

/**
 * §5.2 브런치 그룹. 2~3명씩, 가능하면 성별을 섞고, 피할 쌍(1일차 심야에 1:1을 한 쌍)은 같은 그룹에 넣지 않는다.
 * 제약을 모두 지키는 배치가 없을 수 있어 벌점이 가장 작은 배치를 고른다. 후보는 시드 난수로 만든다(결정적).
 */
export function brunchGroups(members: readonly BrunchMember[], avoid: ReadonlySet<string>, rng: Rng, maxSize: number, tries = 64): ParticipantId[][] {
  const sizes = evenSizes(members.length, maxSize)
  let best: ParticipantId[][] = []
  let bestScore = Number.POSITIVE_INFINITY
  for (let t = 0; t < tries && bestScore > 0; t++) {
    const order = rng.shuffle(members)
    const groups: BrunchMember[][] = []
    let cursor = 0
    for (const size of sizes) {
      groups.push(order.slice(cursor, cursor + size))
      cursor += size
    }
    let score = 0
    for (const g of groups) {
      if (g.length > 1 && new Set(g.map((m) => m.gender)).size === 1) score += 3
      for (let i = 0; i < g.length; i++) for (let j = i + 1; j < g.length; j++) if (avoid.has(pairKey((g[i] as BrunchMember).id, (g[j] as BrunchMember).id))) score += 10
    }
    if (score < bestScore) {
      bestScore = score
      best = groups.map((g) => g.map((m) => m.id))
    }
  }
  return best
}

export interface ActivityPick {
  first: string
  second: string
}

export interface ActivityGroup {
  activityId: string
  members: ParticipantId[]
}

/**
 * §5.4 활동 그룹. 1지망으로 묶고 → 상한을 넘는 그룹은 고르게 나누고 → 혼자인 사람은 2지망 그룹으로,
 * 그래도 혼자면 가장 작은 그룹으로 옮긴다. 모든 참가자가 정확히 한 그룹에 들어간다.
 */
export function activityGroups(order: readonly ParticipantId[], picks: ReadonlyMap<ParticipantId, ActivityPick>, maxSize: number): ActivityGroup[] {
  const byFirst = new Map<string, ParticipantId[]>()
  for (const id of order) {
    const pick = picks.get(id)
    if (!pick) continue
    byFirst.set(pick.first, [...(byFirst.get(pick.first) ?? []), id])
  }
  let groups: ActivityGroup[] = []
  for (const [activityId, ids] of byFirst) {
    let cursor = 0
    for (const size of evenSizes(ids.length, maxSize)) {
      groups.push({ activityId, members: ids.slice(cursor, cursor + size) })
      cursor += size
    }
  }
  const smallest = (cands: ActivityGroup[]): ActivityGroup | undefined => [...cands].sort((a, b) => a.members.length - b.members.length)[0]
  for (;;) {
    const single = groups.find((g) => g.members.length === 1 && groups.length > 1)
    if (!single) break
    const id = single.members[0] as ParticipantId
    const others = groups.filter((g) => g !== single)
    const second = picks.get(id)?.second
    const target = smallest(others.filter((g) => g.activityId === second && g.members.length < maxSize)) ?? (smallest(others) as ActivityGroup)
    target.members.push(id)
    groups = others
  }
  return groups
}

/**
 * §8.4 마지막 데이트. 사람이 고른 상대와의 데이트는 반드시 넣고(required), 서로 고른 쌍, 나머지 선택 순으로
 * 빈 슬롯에 넣는다. 한 슬롯에 한 방이므로 한 사람은 슬롯 수(2)보다 많이 배정되지 않는다.
 */
export function planFinalDates(ballots: Ballots, humanId: ParticipantId, slots: number): SlotPlan {
  const reqs: TalkRequest[] = []
  const humanPick = ballots.get(humanId) ?? null
  if (humanPick !== null) reqs.push({ members: [humanId, humanPick], required: true })
  for (const [a, b] of mutualPairs(new Map(ballots))) reqs.push({ members: [a, b], required: false })
  for (const [voter, target] of ballots) {
    if (target !== null && voter !== humanId) reqs.push({ members: [voter, target], required: false })
  }
  return packSlots(reqs, slots)
}
