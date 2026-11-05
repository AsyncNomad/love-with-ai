import type { ParticipantId, RoomId, SpeechAnswer, SpeechProposalKind } from '@heart/shared'
import { proposableKind, speechChanges, type Rng } from '@heart/engine'
import type { GameSession } from './session'

export interface SpeechPick {
  proposerId: ParticipantId
  targetId: ParticipantId
  kind: SpeechProposalKind
}

/**
 * 사람의 말에 말 놓기와 관련된 뜻이 있을 수 있는지 거르는 감지(판정 작업을 부를지만 정한다, qa-rules.md 2).
 * 실제 판정은 LLM이 하고, 여기서 걸러도 상태는 바뀌지 않는다.
 */
const SPEECH_CUE = /말\s*(을\s*)?(편하게|놓)|반말|편하게\s*(말|해|하)/

export function mayConcernSpeech(text: string): boolean {
  return SPEECH_CUE.test(text)
}

/**
 * 말 놓기(game-rules.md §11, design.md D38). 누가 제안할지 고르고, 제안·응답·말투 변경을 이벤트로 남긴다.
 * 제안하는 말과 대답은 장면(ChatScene)이 인물에게 생성시킨다.
 */
export class SpeechEtiquette {
  constructor(private readonly session: GameSession) {}

  /**
   * 지금 이 방에서 말 놓기를 제안할 쌍(§11.2). 조건을 만족하는 쌍 중에서 확률로 하나 고른다. AI만 먼저 제안한다.
   * 1:1에서만 제안한다. 여럿 앞에서는 누구에게 하는 말인지 흐려졌다(실측 13회차: 거실에서 "다음부터는 좀 더 자연스럽게…").
   */
  pick(members: readonly ParticipantId[], humanId: ParticipantId | null, isPrivate: boolean, rng: Rng): SpeechPick | null {
    if (!isPrivate) return null
    const { speech, relationship } = this.session.config
    if (!rng.chance(Math.min(1, speech.proposeChance * speech.privateMultiplier))) return null
    const state = this.session.state
    const pairs: SpeechPick[] = []
    for (const from of members) {
      if (from === humanId) continue
      for (const to of members) {
        const kind = proposableKind(state, from, to, speech, relationship)
        if (kind) pairs.push({ proposerId: from, targetId: to, kind })
      }
    }
    if (pairs.length === 0) return null
    return rng.weighted(pairs, (p) => 10 + (state.participants.get(p.proposerId)?.cast.traits.extraversion ?? 50))
  }

  /** 제안이 대화로 나온 뒤에 남긴다. 그 방에 있던 사람이 안다. */
  propose(roomId: RoomId, fromId: ParticipantId, toId: ParticipantId, kind: SpeechProposalKind): string {
    const proposalId = `sp_${this.session.state.speechProposals.size + 1}`
    this.session.commit({ type: 'SPEECH_PROPOSED', actor: fromId, payload: { proposalId, roomId, fromId, toId, kind }, visibility: { kind: 'room' } })
    return proposalId
  }

  /** 응답과, 그에 따른 방향 있는 말투 변경(§11.4). 말투 상태는 두 당사자만 안다. */
  answer(roomId: RoomId, proposalId: string, fromId: ParticipantId, toId: ParticipantId, kind: SpeechProposalKind, answer: SpeechAnswer): void {
    this.session.commit({ type: 'SPEECH_ANSWERED', actor: toId, payload: { proposalId, roomId, fromId, toId, answer }, visibility: { kind: 'room' } })
    for (const c of speechChanges(fromId, toId, kind, answer)) {
      this.session.commit({ type: 'SPEECH_LEVEL_SET', payload: { fromId: c.fromId, toId: c.toId, level: 'casual' }, visibility: { kind: 'participants', ids: [fromId, toId] } })
    }
  }
}
