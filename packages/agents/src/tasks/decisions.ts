import { z } from 'zod'
import type { ParticipantId, VoteKind } from '@heart/shared'
import { compatHint } from '@heart/engine'
import { ObservationView } from '../observation'
import { relationshipDetail } from '../persona-text'
import { COMMON_RULES, joinSections, personaSection } from '../prompts'
import type { TaskContext, TaskSpec } from '../task'

/**
 * 판단 작업: 투표·초대(D20). 후보는 이름 enum으로만 받는다. 순서는 호출자가 섞어서 넘긴다.
 * 프롬프트에서 사람 참가자를 표시하지 않는다(D19).
 */

const ABSTAIN = '선택하지 않음'

const VOTE_PROMPTS: Record<VoteKind, { title: string; ask: string }> = {
  first_impression: { title: '첫인상 선택', ask: '지금까지 본 사람 중 첫인상이 가장 좋았던 이성 한 명을 골라라.' },
  night: { title: '심야 선택', ask: '오늘 밤 더 이야기해 보고 싶은 이성 한 명을 골라라.' },
  final: { title: '최종 선택', ask: '3일을 돌아보고 최종적으로 마음이 가는 이성 한 명을 골라라. 끝까지 마음이 가는 사람이 없으면 선택하지 않아도 된다.' },
}

function candidateLines(view: ObservationView, ctx: TaskContext, ids: readonly ParticipantId[]): { lines: string; nameToId: Map<string, ParticipantId> } {
  const nameToId = new Map<string, ParticipantId>()
  const lines = ids.map((id) => {
    const k = view.known(id)
    const name = k.name ?? id
    nameToId.set(name, id)
    const facts = [k.age !== null ? `${k.age}세` : null, k.occupation].filter(Boolean).join(', ')
    const feel = relationshipDetail(view.relationship(id), compatHint(ctx.state, view.ownerId, id, ctx.config.relationship), ctx.config.relationship)
    const mems = view.memories([id], 240).filter((m) => m.aboutIds.includes(id)).slice(-2)
    const memText = mems.length > 0 ? ` 기억: ${mems.map((m) => m.content).join(' / ')}` : ''
    return `- ${name}${facts ? ` (${facts})` : ''}: ${feel}.${memText}`
  })
  return { lines: lines.join('\n'), nameToId }
}

export interface VoteInput {
  voterId: ParticipantId
  kind: VoteKind
  candidateIds: ParticipantId[]
}

export interface VoteOutput {
  targetId: ParticipantId | null
  reason: string
}

export const voteTask: TaskSpec<VoteInput, { choice: string; reason: string }, VoteOutput> = {
  id: 'vote',
  ownerOf: (i) => i.voterId,
  sampling: (ctx) => ctx.config.llm.judgement,
  maxTokens: (ctx) => ctx.config.llm.maxTokens.vote ?? 120,
  schema: (i, ctx) => {
    const view = new ObservationView(ctx.state, i.voterId, ctx.config)
    const names = i.candidateIds.map((id) => view.known(id).name ?? id)
    return z.object({ choice: z.enum([ABSTAIN, ...names] as [string, ...string[]]), reason: z.string().max(120) })
  },
  build: (i, ctx) => {
    const view = new ObservationView(ctx.state, i.voterId, ctx.config)
    const { lines } = candidateLines(view, ctx, i.candidateIds)
    const past = view
      .ownBallots()
      .map((b) => `- ${VOTE_PROMPTS[b.kind as VoteKind]?.title ?? b.kind}: ${b.targetId ? view.label(b.targetId) : ABSTAIN}`)
    const p = VOTE_PROMPTS[i.kind]
    const system = joinSections(
      COMMON_RULES,
      personaSection(view),
      `[출력 규칙]\nJSON으로만 답한다: {"choice":"이름 또는 ${ABSTAIN}","reason":"한 문장"}. 이 선택은 아무에게도 공개되지 않는다.`,
    )
    const user = joinSections(
      `[${p.title}]\n${p.ask}\n네 성격, 가치관, 실제로 나눈 대화를 근거로 판단한다. 모두를 좋게 볼 필요는 없다.\n아직 확신이 없어도 조금이라도 더 끌리는 사람이 있으면 그 사람을 고른다. 아무에게도 전혀 마음이 가지 않을 때만 "${ABSTAIN}"를 고른다.`,
      `[후보]\n${lines}`,
      past.length > 0 ? `[내가 이전에 고른 사람]\n${past.join('\n')}` : '',
    )
    return { system, user, view, meta: { kind: i.kind, voterName: view.self().cast.name } }
  },
  finish: (raw, i, ctx, built) => {
    if (raw.choice === ABSTAIN) return { value: { targetId: null, reason: raw.reason } }
    const view = built.view as ObservationView
    const id = i.candidateIds.find((c) => (view.known(c).name ?? c) === raw.choice)
    return id ? { value: { targetId: id, reason: raw.reason } } : { issues: ['bad_choice'] }
  },
}

export interface InviteInput {
  targetId: ParticipantId
  candidateIds: ParticipantId[]
  maxAccept: number
}

export const inviteDecisionTask: TaskSpec<InviteInput, { accept: string[] }, ParticipantId[]> = {
  id: 'invite_decision',
  ownerOf: (i) => i.targetId,
  sampling: (ctx) => ctx.config.llm.judgement,
  maxTokens: (ctx) => ctx.config.llm.maxTokens.invite_decision ?? 60,
  schema: (i, ctx) => {
    const view = new ObservationView(ctx.state, i.targetId, ctx.config)
    const names = i.candidateIds.map((id) => view.known(id).name ?? id)
    return z.object({ accept: z.array(z.enum(names as [string, ...string[]])).max(i.maxAccept) })
  },
  build: (i, ctx) => {
    const view = new ObservationView(ctx.state, i.targetId, ctx.config)
    const { lines } = candidateLines(view, ctx, i.candidateIds)
    const system = joinSections(
      COMMON_RULES,
      personaSection(view),
      `[출력 규칙]\nJSON으로만 답한다: {"accept":["이름", ...]}. 최대 ${i.maxAccept}명, 아무도 원하지 않으면 빈 배열.`,
    )
    const user = joinSections(
      '[대화 초대]\n아래 사람들이 첫인상 선택에서 너를 골랐다. 잠깐 따로 이야기할 사람을 골라라. 내키지 않으면 거절해도 된다.',
      `[너를 고른 사람]\n${lines}`,
    )
    return { system, user, view, meta: { targetName: view.self().cast.name } }
  },
  finish: (raw, i, _ctx, built) => {
    const view = built.view as ObservationView
    const ids = raw.accept.map((n) => i.candidateIds.find((c) => (view.known(c).name ?? c) === n)).filter((x): x is string => !!x)
    return { value: [...new Set(ids)].slice(0, i.maxAccept) }
  },
}

export interface SelfIntroInput {
  speakerId: ParticipantId
  roomId: string
}

export const selfIntroTask: TaskSpec<SelfIntroInput, { text: string }, string> = {
  id: 'self_intro',
  ownerOf: (i) => i.speakerId,
  sampling: (ctx) => ctx.config.llm.dialogue,
  maxTokens: (ctx) => ctx.config.llm.maxTokens.self_intro ?? 140,
  schema: () => z.object({ text: z.string().max(240) }),
  build: (i, ctx) => {
    const view = new ObservationView(ctx.state, i.speakerId, ctx.config)
    const self = view.self().cast
    const max = ctx.config.validation.maxChars.intro
    const system = joinSections(COMMON_RULES, personaSection(view), `[출력 규칙]\nJSON으로만 답한다: {"text":"..."}. ${max}자 이내.`)
    const user = `[자기소개 시간]\nPD가 너를 호명했다. 모두 앞에서 자기소개를 해라. 반드시 나이 "${self.age}살"과 직업 "${self.occupation}"을 정확히 말한다. 말투는 평소대로 하고 두세 문장으로 짧게.`
    return { system, user, view, meta: { speakerName: self.name, age: String(self.age), occupation: self.occupation } }
  },
  finish: (raw, i, ctx) => {
    const self = ctx.state.participants.get(i.speakerId)?.cast
    if (!self) return { issues: ['bad_choice'] }
    const text = raw.text.trim()
    const okAge = text.includes(String(self.age))
    const okJob = text.includes(self.occupation.split(' ').at(-1) ?? self.occupation)
    if (!okAge || !okJob) return { issues: ['intro_mismatch'] }
    if (text.length > ctx.config.validation.maxChars.intro) return { issues: ['too_long'] }
    return { value: text }
  },
}
