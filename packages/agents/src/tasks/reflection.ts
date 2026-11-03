import { z } from 'zod'
import type { ParticipantId, RelationshipAxis } from '@heart/shared'
import { ObservationView } from '../observation'
import { COMMON_RULES, joinSections, personaSection } from '../prompts'
import type { TaskSpec } from '../task'
import { hasForeignScript } from '../validate'

/**
 * 장면이 끝난 뒤의 성찰 작업(design.md §9, §10.3). 대사 생성과 분리해서 소형 모델의 부담을 줄인다.
 * 근거 이벤트는 서버가 정한다: 이 호출에 실제로 넣은 관찰 이벤트만 근거가 된다.
 */

export interface RelationshipEvalInput {
  ownerId: ParticipantId
  targetIds: ParticipantId[]
  sinceSeq: number
  sceneLabel: string
}

export interface RelationshipEvaluation {
  targetId: ParticipantId
  deltas: Record<RelationshipAxis, number>
  significant: boolean
  impression: string
  casual: boolean
}

const unit = z.union([z.literal(-2), z.literal(-1), z.literal(0), z.literal(1), z.literal(2)])

export const relationshipEvalTask: TaskSpec<RelationshipEvalInput, { evaluations: { name: string; interest: number; comfort: number; trust: number; curiosity: number; significant: boolean; impression: string; casual: boolean }[] }, RelationshipEvaluation[]> = {
  id: 'relationship_eval',
  ownerOf: (i) => i.ownerId,
  sampling: (ctx) => ctx.config.llm.judgement,
  // 대상 한 명당 약 100토큰(실측). 여러 명을 평가하면 상한도 늘린다.
  maxTokens: (ctx, i) => (ctx.config.llm.maxTokens.relationship_eval ?? 140) * Math.max(1, i.targetIds.length) + 60,
  schema: (i, ctx) => {
    const view = new ObservationView(ctx.state, i.ownerId, ctx.config)
    const names = i.targetIds.map((id) => view.known(id).name ?? id)
    return z.object({
      evaluations: z
        .array(
          z.object({
            name: z.enum(names as [string, ...string[]]),
            interest: unit,
            comfort: unit,
            trust: unit,
            curiosity: unit,
            significant: z.boolean(),
            impression: z.string().max(100),
            casual: z.boolean(),
          }),
        )
        .max(i.targetIds.length),
    })
  },
  build: (i, ctx) => {
    const view = new ObservationView(ctx.state, i.ownerId, ctx.config)
    const lines = view.observedSince(i.sinceSeq, 2400).map((l) => l.line)
    const targets = i.targetIds.map((id) => view.label(id)).join(', ')
    const system = joinSections(
      COMMON_RULES,
      personaSection(view),
      '[출력 규칙]\nJSON으로만 답한다. 사람마다 interest(더 알고 싶은 마음), comfort(편안함), trust(신뢰), curiosity(궁금함)의 변화를 -2~2 정수로 준다. 0이 기본이다. 정말 큰 일이 있었을 때만 significant를 true로 한다. impression은 그 사람에 대한 지금 인상을 한 문장으로. 서로 말을 놓기로 했으면 casual을 true로.',
    )
    const user = joinSections(
      `[방금 있었던 일: ${i.sceneLabel}]\n<대화>\n${lines.length > 0 ? lines.join('\n') : '(특별한 대화 없음)'}\n</대화>`,
      `[평가할 사람]\n${targets}\n네 성격과 가치관으로 솔직하게 평가한다. 모두를 좋게 볼 필요는 없다.`,
    )
    return { system, user, view, meta: { ownerName: view.self().cast.name } }
  },
  finish: (raw, i, _ctx, built) => {
    const view = built.view as ObservationView
    const out: RelationshipEvaluation[] = []
    for (const e of raw.evaluations) {
      const id = i.targetIds.find((t) => (view.known(t).name ?? t) === e.name)
      if (!id || out.some((o) => o.targetId === id)) continue
      out.push({
        targetId: id,
        deltas: { interest: e.interest, comfort: e.comfort, trust: e.trust, curiosity: e.curiosity },
        significant: e.significant,
        impression: hasForeignScript(e.impression) ? '' : e.impression.trim(),
        casual: e.casual,
      })
    }
    return { value: out }
  },
}

export interface MemorySummaryInput {
  ownerId: ParticipantId
  sinceSeq: number
  label: string
}

export const memorySummaryTask: TaskSpec<MemorySummaryInput, { summary: string }, string> = {
  id: 'memory_summary',
  ownerOf: (i) => i.ownerId,
  sampling: (ctx) => ctx.config.llm.judgement,
  maxTokens: (ctx) => ctx.config.llm.maxTokens.memory_summary ?? 320,
  schema: () => z.object({ summary: z.string().max(400) }),
  build: (i, ctx) => {
    const view = new ObservationView(ctx.state, i.ownerId, ctx.config)
    const lines = view.observedSince(i.sinceSeq, 3200).map((l) => l.line)
    const system = joinSections(
      COMMON_RULES,
      personaSection(view),
      '[출력 규칙]\nJSON으로만 답한다: {"summary":"..."}. 1인칭 일기처럼 300자 이내. 실제로 보고 들은 것만 쓰고, 추측은 "~인 것 같다"로 쓴다.',
    )
    const user = `[${i.label}: 내가 보고 들은 것]\n<대화>\n${lines.length > 0 ? lines.join('\n') : '(기록 없음)'}\n</대화>\n\n중요한 일과 사람들에 대한 인상을 요약해라.`
    return { system, user, view, meta: { ownerName: view.self().cast.name } }
  },
  finish: (raw) => {
    const text = raw.summary.trim()
    if (text.length === 0) return { issues: ['empty'] }
    return hasForeignScript(text) ? { issues: ['foreign_script'] } : { value: text }
  },
}
