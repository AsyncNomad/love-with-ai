import type { ParticipantId } from '@heart/shared'
import type { RunState } from './state'

/**
 * 선택 가능 대상(design.md §4.2). 성별 자체가 아니라 이 함수가 기준이다.
 * 기본 규칙: 이미 입장한 이성 참가자, 본인 제외.
 */
export type EligibilityRule = (state: RunState, voterId: ParticipantId) => ParticipantId[]

export const oppositeGenderRule: EligibilityRule = (state, voterId) => {
  const voter = state.participants.get(voterId)
  if (!voter || voter.enteredSeq === null) return []
  return [...state.participants.values()]
    .filter((p) => p.cast.id !== voterId && p.enteredSeq !== null && p.cast.gender !== voter.cast.gender)
    .map((p) => p.cast.id)
}

export type BallotError =
  | 'vote_not_found'
  | 'vote_closed'
  | 'not_a_participant'
  | 'already_voted'
  | 'self_vote'
  | 'ineligible_target'

/** game-rules.md §7 검증. 문제가 없으면 null. */
export function validateBallot(
  state: RunState,
  rule: EligibilityRule,
  voteId: string,
  voterId: ParticipantId,
  targetId: ParticipantId | null,
): BallotError | null {
  const vote = state.votes.get(voteId)
  if (!vote) return 'vote_not_found'
  if (vote.closedSeq !== null) return 'vote_closed'
  const voter = state.participants.get(voterId)
  if (!voter || voter.enteredSeq === null) return 'not_a_participant'
  if (vote.ballots.has(voterId)) return 'already_voted'
  if (targetId === null) return null
  if (targetId === voterId) return 'self_vote'
  if (!rule(state, voterId).includes(targetId)) return 'ineligible_target'
  return null
}

/** 투표 결과: voter → target(유보는 null). 투표하지 않은 사람은 빠진다. */
export function ballotsOf(state: RunState, voteId: string): Map<ParticipantId, ParticipantId | null> {
  const vote = state.votes.get(voteId)
  const out = new Map<ParticipantId, ParticipantId | null>()
  if (!vote) return out
  for (const [voter, b] of vote.ballots) out.set(voter, b.targetId)
  return out
}

/** 나를 고른 사람들 */
export function incomingVotes(ballots: Map<ParticipantId, ParticipantId | null>, target: ParticipantId): ParticipantId[] {
  return [...ballots].filter(([, t]) => t === target).map(([v]) => v)
}

/** 최종 매칭: 서로를 고른 쌍만(game-rules.md §6.4). */
export function mutualPairs(ballots: Map<ParticipantId, ParticipantId | null>): [ParticipantId, ParticipantId][] {
  const out: [ParticipantId, ParticipantId][] = []
  for (const [a, b] of ballots) {
    if (b !== null && a < b && ballots.get(b) === a) out.push([a, b])
  }
  return out
}
