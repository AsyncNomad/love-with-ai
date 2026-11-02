import { z } from 'zod'
import type { GameConfig, ParticipantId, SamplingConfig } from '@signal/shared'
import type { RunState } from '@signal/engine'
import { LlmUnavailableError, type LlmPort } from './llm-port'
import type { ObservationView } from './observation'

export interface TaskContext {
  state: RunState
  config: GameConfig
}

export interface BuiltPrompt {
  system: string
  user: string
  /** 컨텍스트를 만든 시점 뷰. 없으면(캐스팅 등) 근거 이벤트가 없다. */
  view: ObservationView | null
  meta: Record<string, string>
}

export type Finish<R> = { value: R; evidenceSeqs?: number[] } | { issues: string[] }

/** design.md §4.2: 새 LLM 작업은 TaskSpec 하나를 추가하는 것으로 끝난다. */
export interface TaskSpec<I, Raw, R> {
  id: string
  ownerOf(input: I): ParticipantId | null
  sampling(ctx: TaskContext, input: I): SamplingConfig
  maxTokens(ctx: TaskContext): number
  schema(input: I, ctx: TaskContext): z.ZodType<Raw>
  build(input: I, ctx: TaskContext): BuiltPrompt
  finish(raw: Raw, input: I, ctx: TaskContext, built: BuiltPrompt): Finish<R>
}

export type TaskResult<R> =
  | { ok: true; value: R; evidenceSeqs: number[]; callId: string }
  | { ok: false; issues: string[]; aborted: boolean }

export interface DeliveryRecord {
  callId: string
  ownerId: ParticipantId | null
  task: string
  attempt: number
  seqAtCall: number
  eventSeqs: number[]
  memoryIds: string[]
  promptText: string
}

export interface CallRecord {
  callId: string
  task: string
  ownerId: ParticipantId | null
  attempt: number
  durationMs: number
  promptTokens: number | null
  completionTokens: number | null
  outcome: 'accepted' | 'rejected' | 'error' | 'aborted'
  issues: string[]
  error: string | null
}

export interface AgentRunnerDeps {
  llm: LlmPort
  context: () => TaskContext
  recordDelivery: (d: DeliveryRecord) => void
  recordCall: (c: CallRecord) => void
  newId: () => string
  now: () => number
}

export function toJsonSchema(schema: z.ZodType): Record<string, unknown> {
  const json = z.toJSONSchema(schema, { target: 'draft-7' }) as Record<string, unknown>
  delete json.$schema
  return json
}

/**
 * 작업 하나를 실행한다: 컨텍스트 조립 → deliveries 기록 → 생성 → 스키마·규칙 검증.
 * 실패하면 설정된 횟수만큼 다시 생성하고, 그래도 안 되면 내용을 지어내지 않고 실패를 돌려준다(원칙 7).
 */
export class AgentRunner {
  constructor(private readonly deps: AgentRunnerDeps) {}

  async run<I, Raw, R>(spec: TaskSpec<I, Raw, R>, input: I, signal?: AbortSignal): Promise<TaskResult<R>> {
    const attempts = this.deps.context().config.llm.retries + 1
    let lastIssues: string[] = []
    for (let attempt = 0; attempt < attempts; attempt++) {
      if (signal?.aborted) return { ok: false, issues: ['aborted'], aborted: true }
      const ctx = this.deps.context()
      const built = spec.build(input, ctx)
      const schema = spec.schema(input, ctx)
      const callId = this.deps.newId()
      const ownerId = spec.ownerOf(input)
      this.deps.recordDelivery({
        callId,
        ownerId,
        task: spec.id,
        attempt,
        seqAtCall: built.view?.seqAtCall ?? ctx.state.lastSeq,
        eventSeqs: built.view ? [...built.view.touched].sort((a, b) => a - b) : [],
        memoryIds: built.view ? [...built.view.memoryIds] : [],
        promptText: `${built.system}\n\n${built.user}`,
      })
      const started = this.deps.now()
      const base = { callId, task: spec.id, ownerId, attempt }
      try {
        const res = await this.deps.llm.generate({
          task: spec.id,
          messages: [
            { role: 'system', content: built.system },
            { role: 'user', content: built.user },
          ],
          jsonSchema: toJsonSchema(schema),
          maxTokens: spec.maxTokens(ctx),
          sampling: spec.sampling(ctx, input),
          ...(signal ? { signal } : {}),
          meta: built.meta,
        })
        const durationMs = this.deps.now() - started
        const tokens = { promptTokens: res.promptTokens, completionTokens: res.completionTokens }
        const parsed = parseJson(res.content, schema)
        if (!parsed.ok) {
          lastIssues = [parsed.issue]
          this.deps.recordCall({ ...base, durationMs, ...tokens, outcome: 'rejected', issues: lastIssues, error: null })
          continue
        }
        const fin = spec.finish(parsed.value, input, this.deps.context(), built)
        if ('issues' in fin) {
          lastIssues = fin.issues
          this.deps.recordCall({ ...base, durationMs, ...tokens, outcome: 'rejected', issues: lastIssues, error: null })
          continue
        }
        this.deps.recordCall({ ...base, durationMs, ...tokens, outcome: 'accepted', issues: [], error: null })
        const evidence = fin.evidenceSeqs ?? (built.view ? [...built.view.touched] : [])
        return { ok: true, value: fin.value, evidenceSeqs: evidence.sort((a, b) => a - b), callId }
      } catch (err) {
        const durationMs = this.deps.now() - started
        if (isAbort(err) || signal?.aborted) {
          this.deps.recordCall({ ...base, durationMs, promptTokens: null, completionTokens: null, outcome: 'aborted', issues: [], error: null })
          return { ok: false, issues: ['aborted'], aborted: true }
        }
        this.deps.recordCall({ ...base, durationMs, promptTokens: null, completionTokens: null, outcome: 'error', issues: [], error: String(err) })
        if (err instanceof LlmUnavailableError) throw err
        lastIssues = ['llm_error']
      }
    }
    return { ok: false, issues: lastIssues, aborted: false }
  }
}

function parseJson<T>(content: string, schema: z.ZodType<T>): { ok: true; value: T } | { ok: false; issue: string } {
  let data: unknown
  try {
    data = JSON.parse(content)
  } catch {
    return { ok: false, issue: 'invalid_json' }
  }
  const r = schema.safeParse(data)
  return r.success ? { ok: true, value: r.data } : { ok: false, issue: 'schema_mismatch' }
}

function isAbort(err: unknown): boolean {
  return err instanceof Error && err.name === 'AbortError'
}
