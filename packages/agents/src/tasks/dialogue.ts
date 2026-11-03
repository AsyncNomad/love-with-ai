import { z } from 'zod'
import type { ParticipantId, RoomId } from '@heart/shared'
import { ObservationView } from '../observation'
import { COMMON_RULES, conversationSection, joinSections, memorySection, peopleSection, personaSection, situationSection } from '../prompts'
import type { TaskSpec } from '../task'
import { checkDialogue, fitLength, limitLaughter, normalizeUtterance } from '../validate'

export type DialogueMode = 'reply' | 'start_topic' | 'greeting' | 'open_private' | 'wrap_up' | 'follow_up'

export interface DialogueInput {
  speakerId: ParticipantId
  roomId: RoomId
  mode: DialogueMode
  /** 1:1(사람 수 2)인지. 길이 상한이 달라진다. */
  isPrivate: boolean
}

export interface DialogueOutput {
  text: string | null
}

const INSTRUCTIONS: Record<DialogueMode, string> = {
  reply: '대화 흐름에 맞게 다음 말을 한 마디 해라. 할 말이 없으면 침묵해도 된다.',
  follow_up: '방금 나온 말에 자연스럽게 이어서 한 마디 해라. 굳이 할 말이 없으면 침묵해라.',
  start_topic: '대화가 잠시 끊겼다. 네 성격에 맞게 가볍게 새 화제를 꺼내라. 이미 나온 얘기를 반복하지 마라.',
  greeting: '방금 숙소 거실에 처음 들어왔다. 먼저 와 있던 사람들에게 짧게 인사해라. 이름만 밝히고 나이나 직업은 아직 말하지 않는다.',
  open_private: '단둘이 이야기할 시간이 생겼다. 상대에게 먼저 가볍게 말을 걸어라.',
  wrap_up: '대화 시간이 곧 끝난다. 새 화제를 꺼내지 말고 자연스럽게 마무리하는 말을 해라.',
}

export const dialogueTask: TaskSpec<DialogueInput, { action: 'speak' | 'silent'; text: string }, DialogueOutput> = {
  id: 'dialogue',
  ownerOf: (i) => i.speakerId,
  sampling: (ctx, i) => {
    const base = ctx.config.llm.dialogue
    const offset = ctx.state.participants.get(i.speakerId)?.cast.speech.temperatureOffset ?? 0
    return { ...base, temperature: Math.max(0.1, base.temperature + offset) }
  },
  maxTokens: (ctx) => ctx.config.llm.maxTokens.dialogue ?? 120,
  schema: (i) => {
    const mustSpeak = i.mode === 'greeting' || i.mode === 'open_private'
    return z.object({
      action: mustSpeak ? z.literal('speak') : z.enum(['speak', 'silent']),
      text: z.string().max(240),
    })
  },
  build: (i, ctx) => {
    const view = new ObservationView(ctx.state, i.speakerId, ctx.config)
    const others = view.presentOthers(i.roomId)
    const maxChars = i.isPrivate ? ctx.config.validation.maxChars.private : ctx.config.validation.maxChars.group
    const system = joinSections(
      COMMON_RULES,
      personaSection(view),
      `[출력 규칙]\nJSON으로만 답한다. 말할 때는 {"action":"speak","text":"..."}, 침묵할 때는 {"action":"silent","text":""}.\n실제 메신저처럼 한두 문장, ${maxChars}자 이내로 쓴다. 매번 질문으로 끝내지 않는다. 웃음 표현(ㅋㅋ)은 인물 설정에 있을 때만 쓴다.`,
    )
    const user = joinSections(
      situationSection(view, i.roomId),
      peopleSection(view, ctx, others),
      memorySection(view, ctx, others),
      conversationSection(view, ctx, i.roomId),
      `[지금 할 일]\n${INSTRUCTIONS[i.mode]}`,
    )
    const self = view.self().cast
    return { system, user, view, meta: { mode: i.mode, speakerName: self.name, roomId: i.roomId } }
  },
  finish: (raw, i, ctx, built) => {
    if (raw.action === 'silent') return { value: { text: null } }
    const view = built.view as ObservationView
    const cast = ctx.state.participants.get(i.speakerId)?.cast
    const speakerName = cast?.name ?? ''
    const maxChars = i.isPrivate ? ctx.config.validation.maxChars.private : ctx.config.validation.maxChars.group
    const normalized = limitLaughter(normalizeUtterance(raw.text, speakerName), cast?.speech.laughter ?? 0)
    if (normalized.length === 0) return { value: { text: null } }
    const fitted = fitLength(normalized, maxChars) ?? normalized
    const issues = checkDialogue(
      {
        text: fitted,
        speakerName,
        maxChars,
        unknownNames: view.unknownNames(),
        recentOwn: view.ownRecentMessages(ctx.config.validation.repetitionWindow),
        mustBePolite: view.presentOthers(i.roomId).every((id) => view.speechLevel(id) === 'polite'),
      },
      ctx.config.validation,
    )
    return issues.length > 0 ? { issues } : { value: { text: fitted } }
  },
}
