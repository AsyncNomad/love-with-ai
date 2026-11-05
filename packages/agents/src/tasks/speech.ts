import { z } from 'zod'
import type { ParticipantId, RoomId, SpeechAnswer, SpeechProposalKind } from '@heart/shared'
import { ageRelation, answersFor } from '@heart/engine'
import { ObservationView } from '../observation'
import { COMMON_RULES, conversationSection, joinSections, memorySection, peopleSection, personaSection, situationSection } from '../prompts'
import type { TaskSpec } from '../task'
import { checkDialogue, fitLength, fixAddress, limitLaughter, normalizeUtterance } from '../validate'

/**
 * 말 놓기 응답과 사람의 말 판정(game-rules.md §11, design.md D38).
 * 제안과 응답은 실제 대화로 오가고, 상태 변경은 서버가 이벤트로 한다. 문구는 정하지 않는다(qa-rules.md 1.2).
 */

const KIND_TEXT: Record<SpeechProposalKind, string> = {
  mutual: '서로 말을 편하게 하자',
  ask: '자기가 말을 편하게 해도 되겠냐',
  grant: '너에게 편하게 말을 놓으라',
}

const ANSWER_TEXT: Record<Exclude<SpeechAnswer, 'none'>, string> = {
  accept: '받아들인다',
  you_only: '상대는 편하게 말해도 되지만 너는 존댓말을 그대로 쓴다',
  decline: '아직은 존댓말이 편하다',
}

export interface SpeechResponseInput {
  responderId: ParticipantId
  proposerId: ParticipantId
  kind: SpeechProposalKind
  roomId: RoomId
}

export interface SpeechResponseOutput {
  answer: SpeechAnswer
  text: string
}

export const speechResponseTask: TaskSpec<SpeechResponseInput, { answer: string; text: string }, SpeechResponseOutput> = {
  id: 'speech_response',
  ownerOf: (i) => i.responderId,
  sampling: (ctx) => ctx.config.llm.dialogue,
  maxTokens: (ctx) => ctx.config.llm.maxTokens.dialogue ?? 120,
  schema: (i) => z.object({ answer: z.enum(answersFor(i.kind) as [string, ...string[]]), text: z.string().max(240) }),
  build: (i, ctx) => {
    const view = new ObservationView(ctx.state, i.responderId, ctx.config)
    const proposer = view.label(i.proposerId)
    const age = ageRelation(view.self().cast.age, view.known(i.proposerId).age) ?? '나이는 모른다'
    const options = answersFor(i.kind)
      .map((a) => `- ${a}: ${ANSWER_TEXT[a as Exclude<SpeechAnswer, 'none'>]}`)
      .join('\n')
    const system = joinSections(
      COMMON_RULES,
      personaSection(view),
      '[출력 규칙]\nJSON으로만 답한다: {"answer":"고른 것","text":"대답 한 마디"}. 실제 메신저처럼 한두 문장.',
    )
    const user = joinSections(
      situationSection(view, i.roomId),
      peopleSection(view, ctx, [i.proposerId]),
      memorySection(view, ctx, [i.proposerId]),
      conversationSection(view, ctx, i.roomId),
      `[지금 할 일]\n${proposer}(${age})이(가) 방금 ${KIND_TEXT[i.kind]}는 뜻으로 말했다. 네 성격, 이 사람에 대한 마음, 나이 차를 생각해서 정한다. 모두에게 좋게 대할 필요는 없다.\n${options}\n정한 마음에 맞게 대답한다. 받아들였으면 그 대답부터 바뀐 말투로 해도 된다.`,
    )
    return { system, user, view, meta: { mode: 'speech_response', speakerName: view.self().cast.name, kind: i.kind } }
  },
  finish: (raw, i, ctx, built) => {
    const view = built.view as ObservationView
    const self = view.self().cast
    const answer = raw.answer as SpeechAnswer
    const maxChars = ctx.config.validation.maxChars.private
    const knownNames = [...view.knownNames()]
      .filter((id) => id !== i.responderId)
      .map((id) => view.known(id).name)
      .filter((n): n is string => n !== null)
    const cleaned = limitLaughter(fixAddress(normalizeUtterance(raw.text, self.name), knownNames), self.speech.laughter)
    const text = fitLength(cleaned, maxChars) ?? cleaned
    // 받아들여서 응답자가 제안자에게 반말을 쓰게 되면, 1:1에서는 그 대답부터 반말이어도 된다. 그 밖에는 존댓말이다.
    const becomesCasual = answer === 'accept' && (i.kind === 'mutual' || i.kind === 'grant')
    const others = view.presentOthers(i.roomId)
    const mustBePolite = !(becomesCasual && others.length === 1 && others[0] === i.proposerId)
    const issues = checkDialogue(
      { text, speakerName: self.name, maxChars, unknownNames: view.unknownNames(), recentOwn: view.ownRecentMessages(5), mustBePolite, knownNames },
      ctx.config.validation,
    )
    return issues.length > 0 ? { issues } : { value: { answer, text } }
  },
}

const NONE = '없음'

export interface HumanSpeechInput {
  /** offer: 사람이 누군가에게 말 놓기를 제안했는지. answer: AI의 제안에 사람이 어떻게 대답했는지. */
  mode: 'offer' | 'answer'
  text: string
  /** offer일 때 제안 대상 후보(그 방의 AI) */
  candidateIds: ParticipantId[]
  /** answer일 때의 제안 */
  proposal?: { proposerId: ParticipantId; kind: SpeechProposalKind; said: string }
}

export type HumanSpeechOutput = { kind: 'offer'; targetId: ParticipantId; offer: SpeechProposalKind } | { kind: 'answer'; answer: SpeechAnswer } | { kind: 'none' }

/**
 * 사람의 말을 읽는 판정 작업. 서버 쪽 판단이라 참가자 시점이 아니다(ownerOf null). 판정할 문장과 후보 이름만 넣는다.
 * 불확실하면 none을 돌려 아무것도 바꾸지 않는다(game-rules.md §11.5).
 */
export const humanSpeechTask: TaskSpec<HumanSpeechInput, { target?: string; kind?: string; answer?: string }, HumanSpeechOutput> = {
  id: 'human_speech',
  ownerOf: () => null,
  sampling: (ctx) => ctx.config.llm.judgement,
  maxTokens: () => 60,
  schema: (i, ctx) => {
    if (i.mode === 'answer') return z.object({ answer: z.enum(['accept', 'you_only', 'decline', 'unclear']) })
    const names = i.candidateIds.map((id) => ctx.state.participants.get(id)?.cast.name ?? id)
    return z.object({ target: z.enum([NONE, ...names] as [string, ...string[]]), kind: z.enum(['mutual', 'ask', 'grant', 'none']) })
  },
  build: (i, ctx) => {
    const name = (id: ParticipantId): string => ctx.state.participants.get(id)?.cast.name ?? id
    const system = '너는 메신저 대화를 읽고 말투(존댓말·반말)에 관한 뜻만 판정하는 분석기다. JSON으로만 답한다. 확실하지 않으면 확실하지 않다고 답한다.'
    if (i.mode === 'answer' && i.proposal) {
      // 실측(13회차): 제안과 상관없는 대답("처음엔 어색했는데 이제 좀 편해졌어요")을 받아들임으로 읽었다. 실제 제안 문장을 함께 주고, 분명할 때만 판정하게 한다.
      const user = `[제안] ${name(i.proposal.proposerId)}이(가) ${KIND_TEXT[i.proposal.kind]}는 뜻으로 이렇게 말했다.\n<제안>\n${i.proposal.said}\n</제안>\n[바로 다음에 온 대답]\n<대답>\n${i.text}\n</대답>\n\n대답이 이 제안에 대해 분명히 좋다고 한 것이면 accept, 상대만 편하게 하라고 한 것이면 you_only, 분명히 거절한 것이면 decline. 제안과 상관없는 말이거나 판단할 수 없으면 unclear.`
      return { system, user, view: null, meta: { mode: 'answer' } }
    }
    const names = i.candidateIds.map(name).join(', ')
    const user = `[대화 상대] ${names}\n[말]\n${i.text}\n\n이 말이 누군가에게 말을 편하게 하자는 제안이면 target에 그 사람, kind에 mutual(서로 말을 놓자)·ask(자기가 말을 놓아도 되냐)·grant(상대에게 말을 놓으라) 중 하나. 그런 제안이 아니거나 대상을 알 수 없으면 target은 "${NONE}", kind는 none.`
    return { system, user, view: null, meta: { mode: 'offer' } }
  },
  finish: (raw, i, ctx) => {
    if (i.mode === 'answer') {
      const a = raw.answer
      return { value: a === 'accept' || a === 'you_only' || a === 'decline' ? { kind: 'answer', answer: a } : { kind: 'none' } }
    }
    const targetId = i.candidateIds.find((id) => (ctx.state.participants.get(id)?.cast.name ?? id) === raw.target)
    const kind = raw.kind
    if (!targetId || (kind !== 'mutual' && kind !== 'ask' && kind !== 'grant')) return { value: { kind: 'none' } }
    return { value: { kind: 'offer', targetId, offer: kind } }
  },
}
