import type { AnyEvent, GameConfig } from '@heart/shared'
import { applyEvent, canObserve, createRunState, type RunState } from '@heart/engine'
import { foldOptionsFor } from '@heart/runtime'

/**
 * 회차 기록을 사람이 읽는 대화록으로 바꾼다(design.md §16 god 로그).
 * `as`를 주면 그 참가자가 관찰한 것만 보여 준다(시점 확인용). 없으면 전부(투표·관계 포함).
 */
export function renderTranscript(events: readonly AnyEvent[], config: GameConfig, as: string | null): string {
  const state: RunState = createRunState(events[0]?.runId ?? 'run')
  const fold = foldOptionsFor(config)
  for (const e of events) applyEvent(state, e, fold)
  const name = (id: string): string => state.participants.get(id)?.cast.name ?? id
  const where = (roomId: string | null): string => (roomId ? (state.rooms.get(roomId)?.location ?? roomId) : '하우스')
  const lines: string[] = []
  for (const e of state.events) {
    if (as && !canObserve(state, as, e) && e.type !== 'STAGE_STARTED') continue
    const t = e.simTime.padEnd(8)
    switch (e.type) {
      case 'STAGE_STARTED':
        lines.push('', `━━ ${e.payload.stage} (${e.payload.simTime}) ━━`)
        break
      case 'PARTICIPANT_CAST': {
        const c = e.payload.participant
        if (!as) lines.push(`${t} [캐스팅] ${c.id} ${c.name} ${c.gender === 'female' ? '여' : '남'} ${c.age}세 ${c.occupation}${c.isHuman ? ' (사람)' : ''}${c.isCatfish ? ' (메기)' : ''}`)
        break
      }
      case 'PERSONA_FLAVORED':
        if (!as) lines.push(`${t} [인격] ${name(e.payload.participantId)}${e.payload.fallback ? ' (템플릿 대체)' : ''}: ${e.payload.flavor.speechDescription} / 예: ${e.payload.flavor.exampleLines.slice(0, 2).join(' | ')}`)
        break
      case 'HOUSE_ENTERED':
        lines.push(`${t} [입장] ${name(e.payload.participantId)}`)
        break
      case 'MESSAGE_SENT':
        lines.push(`${t} [${where(e.payload.roomId)}] ${name(e.actor)}: ${e.payload.text}`)
        break
      case 'PD_ANNOUNCED':
        lines.push(`${t} [${where(e.payload.roomId)}] PD: ${e.payload.text}`)
        break
      case 'VOTE_COMMITTED':
        lines.push(`${t} [투표] ${name(e.payload.voterId)} → ${e.payload.targetId ? name(e.payload.targetId) : '유보'}${e.payload.auto ? ' (자동)' : ''}${e.payload.reason ? ` — ${e.payload.reason}` : ''}`)
        break
      case 'INVITE_DECIDED':
        lines.push(`${t} [초대] ${name(e.payload.targetId)}: ${e.payload.candidateIds.map(name).join(', ')} 중 수락 ${e.payload.acceptedIds.map(name).join(', ') || '없음'}`)
        break
      case 'TALKS_PLANNED':
        if (!as) lines.push(`${t} [배정] ${e.payload.slots.map((s, i) => `슬롯${i + 1}: ${s.map((r) => r.members.map(name).join('+')).join(', ')}`).join(' / ')}`)
        break
      case 'RELATIONSHIP_UPDATED': {
        const d = e.payload.deltas
        lines.push(`${t} [관계] ${name(e.payload.sourceId)}→${name(e.payload.targetId)} 관심${sign(d.interest)} 편안${sign(d.comfort)} 신뢰${sign(d.trust)} 궁금${sign(d.curiosity)}${e.payload.significant ? ' (큰 변화)' : ''}`)
        break
      }
      case 'MEMORY_RECORDED':
        lines.push(`${t} [기억:${e.payload.kind}] ${name(e.payload.ownerId)}: ${e.payload.content}`)
        break
      case 'LLM_OUTPUT_REJECTED':
        if (!as) lines.push(`${t} [거부] ${e.payload.task} ${e.payload.ownerId ? name(e.payload.ownerId) : ''}: ${e.payload.reasons.join(',')}`)
        break
      case 'RUN_COMPLETED':
        lines.push('', `━━ 종료: ${e.payload.reason} ━━`)
        break
      default:
        break
    }
  }
  return lines.join('\n')
}

function sign(n: number): string {
  return n > 0 ? `+${n}` : String(n)
}
