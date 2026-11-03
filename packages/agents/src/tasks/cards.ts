import { z } from 'zod'
import type { ParticipantId } from '@heart/shared'
import { containsName } from '@heart/engine'
import { ObservationView } from '../observation'
import { COMMON_RULES, joinSections, personaSection, privateSignalsSection } from '../prompts'
import type { TaskSpec } from '../task'
import { checkDialogue, fitLength, normalizeUtterance } from '../validate'
import { candidateLines } from './decisions'

/**
 * 익명 시그널 카드(game-rules.md §5.5). 대상 1명과 짧은 메시지를 고르거나 보내지 않는다.
 * 카드 본문에 보낸 사람 본인의 이름(호칭 변형 포함)이 들어가면 거부한다. 알아볼 만한 힌트는 허용한다.
 */

const NONE = '보내지 않음'

export interface SignalCardInput {
  senderId: ParticipantId
  candidateIds: ParticipantId[]
}

export interface SignalCardOutput {
  targetId: ParticipantId | null
  text: string
}

export const signalCardTask: TaskSpec<SignalCardInput, { target: string; text: string }, SignalCardOutput> = {
  id: 'signal_card',
  ownerOf: (i) => i.senderId,
  sampling: (ctx) => ctx.config.llm.dialogue,
  maxTokens: (ctx) => ctx.config.llm.maxTokens.signal_card ?? 120,
  schema: (i, ctx) => {
    const view = new ObservationView(ctx.state, i.senderId, ctx.config)
    const names = i.candidateIds.map((id) => view.known(id).name ?? id)
    return z.object({ target: z.enum([NONE, ...names] as [string, ...string[]]), text: z.string().max(200) })
  },
  build: (i, ctx) => {
    const view = new ObservationView(ctx.state, i.senderId, ctx.config)
    const { lines } = candidateLines(view, ctx, i.candidateIds)
    const max = ctx.config.validation.maxChars.card
    const system = joinSections(
      COMMON_RULES,
      personaSection(view),
      `[출력 규칙]\nJSON으로만 답한다: {"target":"이름 또는 ${NONE}","text":"카드 내용"}. 카드 내용은 ${max}자 이내, 존댓말로 쓴다.`,
    )
    const user = joinSections(
      `[익명 시그널 카드]\n마음이 가는 이성 한 명에게 이름을 밝히지 않는 짧은 카드를 보낸다. 받는 사람은 누가 보냈는지 모른다.\n카드 내용은 받는 사람에게 직접 건네는 말로, 함께 나눈 구체적인 순간이나 그 사람의 좋았던 점을 한두 문장으로 쓴다. 카드나 익명이라는 사실 자체는 이야기하지 않는다.\n네 이름은 절대 쓰지 않는다. 마음이 가는 사람이 없으면 "${NONE}"을 고른다.`,
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
    const max = ctx.config.validation.maxChars.card
    const normalized = normalizeUtterance(raw.text, self.name)
    const text = fitLength(normalized, max) ?? normalized
    if (containsName(text, self.name)) return { issues: ['sender_name'] }
    // 실측: "혹시 그분에게 이 카드가 닿을까요?"처럼 받는 사람이 아니라 카드 자체를 말하는 문장이 나왔다.
    if (/카드|그분|익명/.test(text)) return { issues: ['card_meta'] }
    const knownNames = [...view.knownNames()].filter((id) => id !== i.senderId).map((id) => view.known(id).name).filter((n): n is string => n !== null)
    const issues = checkDialogue(
      { text, speakerName: self.name, maxChars: max, unknownNames: view.unknownNames(), recentOwn: [], mustBePolite: view.speechLevel(targetId) === 'polite', knownNames },
      ctx.config.validation,
    )
    return issues.length > 0 ? { issues } : { value: { targetId, text } }
  },
}
