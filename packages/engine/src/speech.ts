import type { ParticipantId, RelationshipConfig, SpeechAnswer, SpeechConfig, SpeechLevel, SpeechProposalKind } from '@heart/shared'
import { exposure } from './relationship'
import { directedKey, getRelationship, pairKey, type RunState } from './state'
import { knownProfile } from './visibility'

/** 말투 규칙(game-rules.md §11, design.md D38). 모두 순수 함수다. */

/** from이 to에게 쓰는 말투. 기록이 없으면 존댓말이다. */
export function speechLevelOf(state: RunState, from: ParticipantId, to: ParticipantId): SpeechLevel {
  return state.speechLevels.get(directedKey(from, to)) ?? 'polite'
}

/** §11.3: 나이 차(제안자 − 상대)로 제안의 종류를 정한다. */
export function proposalKind(fromAge: number, toAge: number, cfg: SpeechConfig): SpeechProposalKind {
  const gap = fromAge - toAge
  if (gap < 0) return 'grant'
  return gap <= cfg.mutualMaxGap ? 'mutual' : 'ask'
}

/**
 * §11.2: from이 지금 to에게 말 놓기를 제안할 수 있으면 그 종류를, 아니면 null.
 * 확률과 "같은 방, 장면에서 몇 마디"는 호출자(장면)가 정한다.
 */
export function proposableKind(state: RunState, from: ParticipantId, to: ParticipantId, cfg: SpeechConfig, rel: RelationshipConfig): SpeechProposalKind | null {
  if (from === to || state.speechProposals.has(pairKey(from, to))) return null
  const me = state.participants.get(from)
  const them = state.participants.get(to)
  if (!me || !them || me.enteredSeq === null || them.enteredSeq === null) return null
  const theirAge = knownProfile(state, from, to).age
  if (theirAge === null) return null
  if (exposure(state, from, to, rel) < cfg.minExposure) return null
  if (getRelationship(state, from, to, rel.initial).comfort < cfg.minComfort) return null
  const kind = proposalKind(me.cast.age, theirAge, cfg)
  // 바뀔 것이 없는 제안은 하지 않는다(이미 그 방향으로 말을 놓았다).
  const changes = speechChanges(from, to, kind, 'accept')
  if (changes.every((c) => speechLevelOf(state, c.fromId, c.toId) === 'casual')) return null
  return kind
}

/** §11.4: 제안과 응답에 따라 반말로 바뀌는 방향들. */
export function speechChanges(proposer: ParticipantId, target: ParticipantId, kind: SpeechProposalKind, answer: SpeechAnswer): { fromId: ParticipantId; toId: ParticipantId }[] {
  if (answer === 'decline' || answer === 'none') return []
  const proposerToTarget = { fromId: proposer, toId: target }
  const targetToProposer = { fromId: target, toId: proposer }
  switch (kind) {
    case 'mutual':
      return answer === 'you_only' ? [proposerToTarget] : [proposerToTarget, targetToProposer]
    case 'ask':
      return answer === 'accept' ? [proposerToTarget] : []
    case 'grant':
      return answer === 'accept' ? [targetToProposer] : []
  }
}

/** 제안 종류마다 고를 수 있는 응답. "상대만 놓기"는 서로 놓자는 제안에만 있다. */
export function answersFor(kind: SpeechProposalKind): SpeechAnswer[] {
  return kind === 'mutual' ? ['accept', 'you_only', 'decline'] : ['accept', 'decline']
}

/** 나이 관계를 사람이 읽는 말로(프롬프트용 사실). 모르면 null. */
export function ageRelation(myAge: number, theirAge: number | null): string | null {
  if (theirAge === null) return null
  const gap = theirAge - myAge
  if (gap === 0) return '나와 동갑'
  return gap > 0 ? `나보다 ${gap}살 많음` : `나보다 ${-gap}살 어림`
}
