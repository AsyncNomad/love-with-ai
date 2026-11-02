import type { ParticipantId } from '@signal/shared'
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
