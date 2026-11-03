import { z } from 'zod'
import type { ParticipantId } from '@heart/shared'
import { ObservationView } from '../observation'
import { COMMON_RULES, joinSections, personaSection } from '../prompts'
import type { TaskSpec } from '../task'

/**
 * 2일차 활동 지망(game-rules.md §5.4). 후보는 이름 enum으로만 받고, 순서는 호출자가 섞는다(D20).
 * 다른 사람이 어디를 고를지는 알려 주지 않는다. 그룹은 서버가 순수 함수로 짠다.
 */

export interface ActivityOption {
  id: string
  name: string
  description: string
}

export interface ActivityChoiceInput {
  participantId: ParticipantId
  options: ActivityOption[]
}

export const activityChoiceTask: TaskSpec<ActivityChoiceInput, { first: string; second: string }, { first: string; second: string }> = {
  id: 'activity_choice',
  ownerOf: (i) => i.participantId,
  sampling: (ctx) => ctx.config.llm.judgement,
  maxTokens: (ctx) => ctx.config.llm.maxTokens.activity_choice ?? 60,
  schema: (i) => {
    const names = i.options.map((o) => o.name) as [string, ...string[]]
    return z.object({ first: z.enum(names), second: z.enum(names) })
  },
  build: (i, ctx) => {
    const view = new ObservationView(ctx.state, i.participantId, ctx.config)
    const system = joinSections(COMMON_RULES, personaSection(view), '[출력 규칙]\nJSON으로만 답한다: {"first":"1지망 활동","second":"2지망 활동"}. 1지망과 2지망은 달라야 한다.')
    const user = joinSections(
      `[오후 활동 선택]\n오후에 할 활동을 1지망과 2지망으로 골라라. 같은 활동을 고른 사람끼리 함께 간다. 누가 무엇을 고를지는 모른다.`,
      `[활동]\n${i.options.map((o) => `- ${o.name}: ${o.description}`).join('\n')}`,
    )
    return { system, user, view, meta: { name: view.self().cast.name } }
  },
  finish: (raw, i) => {
    const first = i.options.find((o) => o.name === raw.first)
    const second = i.options.find((o) => o.name === raw.second)
    if (!first || !second || first.id === second.id) return { issues: ['bad_choice'] }
    return { value: { first: first.id, second: second.id } }
  },
}
