import { z } from 'zod'
import type { ParticipantId } from '@heart/shared'
import { ObservationView } from '../observation'
import { COMMON_RULES, joinSections, memorySection, personaSection, privateSignalsSection } from '../prompts'
import type { TaskSpec } from '../task'
import { checkDialogue, fitLength, normalizeUtterance } from '../validate'
import { candidateLines } from './decisions'

/**
 * 시그널 우체통(game-rules.md §6.1). 한 명에게 질문 하나를 보내거나 보내지 않고, 받은 질문에는 답한다.
 * 질문과 답은 두 사람만 본다.
 */

const NONE = '보내지 않음'

function namesKnownTo(view: ObservationView, selfId: ParticipantId): string[] {
  return [...view.knownNames()]
    .filter((id) => id !== selfId)
    .map((id) => view.known(id).name)
    .filter((n): n is string => n !== null)
}

export interface MailboxQuestionInput {
  askerId: ParticipantId
  candidateIds: ParticipantId[]
}

export const mailboxQuestionTask: TaskSpec<MailboxQuestionInput, { target: string; text: string }, { targetId: ParticipantId | null; text: string }> = {
  id: 'mailbox_question',
  ownerOf: (i) => i.askerId,
  sampling: (ctx) => ctx.config.llm.dialogue,
  maxTokens: (ctx) => ctx.config.llm.maxTokens.mailbox_question ?? 120,
  schema: (i, ctx) => {
    const view = new ObservationView(ctx.state, i.askerId, ctx.config)
    const names = i.candidateIds.map((id) => view.known(id).name ?? id)
    return z.object({ target: z.enum([NONE, ...names] as [string, ...string[]]), text: z.string().max(200) })
  },
  build: (i, ctx) => {
    const view = new ObservationView(ctx.state, i.askerId, ctx.config)
    const { lines } = candidateLines(view, ctx, i.candidateIds)
    const max = ctx.config.validation.maxChars.mailbox
    const system = joinSections(
      COMMON_RULES,
      personaSection(view),
      `[출력 규칙]\nJSON으로만 답한다: {"target":"이름 또는 ${NONE}","text":"질문"}. 질문은 ${max}자 이내 한 문장, 존댓말 의문문으로 쓴다.`,
    )
    const user = joinSections(
      `[시그널 우체통]\n마지막 날 아침이다. 더 알고 싶은 이성 한 명에게 질문 하나를 보낸다. 질문과 답은 둘만 본다.\n지금까지 나눈 대화를 바탕으로 정말 궁금한 것을 묻는다. 궁금한 사람이 없으면 "${NONE}"을 고른다.`,
      `[후보]\n${lines}`,
      privateSignalsSection(view),
    )
    return { system, user, view, meta: { speakerName: view.self().cast.name } }
  },
  finish: (raw, i, ctx, built) => {
    if (raw.target === NONE) return { value: { targetId: null, text: '' } }
    const view = built.view as ObservationView
    const targetId = i.candidateIds.find((c) => (view.known(c).name ?? c) === raw.target)
    if (!targetId) return { issues: ['bad_choice'] }
    const self = view.self().cast
    const max = ctx.config.validation.maxChars.mailbox
    const normalized = normalizeUtterance(raw.text, self.name)
    const text = fitLength(normalized, max) ?? normalized
    const issues = checkDialogue(
      { text, speakerName: self.name, maxChars: max, unknownNames: view.unknownNames(), recentOwn: [], mustBePolite: view.speechLevel(targetId) === 'polite', knownNames: namesKnownTo(view, i.askerId) },
      ctx.config.validation,
    )
    return issues.length > 0 ? { issues } : { value: { targetId, text } }
  },
}

export interface MailboxAnswerInput {
  answererId: ParticipantId
  askerId: ParticipantId
  question: string
}

export const mailboxAnswerTask: TaskSpec<MailboxAnswerInput, { text: string }, string> = {
  id: 'mailbox_answer',
  ownerOf: (i) => i.answererId,
  sampling: (ctx) => ctx.config.llm.dialogue,
  maxTokens: (ctx) => ctx.config.llm.maxTokens.mailbox_answer ?? 140,
  schema: () => z.object({ text: z.string().max(240) }),
  build: (i, ctx) => {
    const view = new ObservationView(ctx.state, i.answererId, ctx.config)
    const max = ctx.config.validation.maxChars.mailbox
    const asker = view.label(i.askerId)
    const system = joinSections(COMMON_RULES, personaSection(view), `[출력 규칙]\nJSON으로만 답한다: {"text":"답"}. ${max}자 이내, 한두 문장.`)
    const user = joinSections(
      memorySection(view, ctx, [i.askerId]),
      `[시그널 우체통]\n${asker}이(가) 우체통으로 질문을 보냈다. 둘만 보는 답장이다. 네 성격대로 솔직하게 답한다.`,
      `<질문>\n${i.question}\n</질문>`,
    )
    return { system, user, view, meta: { speakerName: view.self().cast.name } }
  },
  finish: (raw, i, ctx, built) => {
    const view = built.view as ObservationView
    const self = view.self().cast
    const max = ctx.config.validation.maxChars.mailbox
    const normalized = normalizeUtterance(raw.text, self.name)
    const text = fitLength(normalized, max) ?? normalized
    const issues = checkDialogue(
      { text, speakerName: self.name, maxChars: max, unknownNames: view.unknownNames(), recentOwn: [], mustBePolite: view.speechLevel(i.askerId) === 'polite', knownNames: namesKnownTo(view, i.answererId) },
      ctx.config.validation,
    )
    return issues.length > 0 ? { issues } : { value: text }
  },
}
