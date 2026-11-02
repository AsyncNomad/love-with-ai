import type { SamplingConfig } from '@heart/shared'

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface LlmRequest {
  task: string
  messages: ChatMessage[]
  /** llama-server response_format(json_schema)로 출력을 제약한다. */
  jsonSchema: Record<string, unknown>
  maxTokens: number
  sampling: SamplingConfig
  signal?: AbortSignal
  /** 로그·FakeLlm용 부가 정보(모드, 화자 이름 등). 프롬프트에는 들어가지 않는다. */
  meta: Record<string, string>
}

export interface LlmTimings {
  promptTokens: number
  promptMs: number
  predictedTokens: number
  predictedMs: number
}

export interface LlmResponse {
  content: string
  promptTokens: number | null
  completionTokens: number | null
  /** 엔진이 알려 준 처리 시간(있을 때만). 측정(bench)에 쓴다. */
  timings?: LlmTimings
  /** thinking 출력이 섞여 나왔다면 그 내용. thinking off(D5)가 지켜지는지 확인하는 데 쓴다. */
  reasoning?: string
}

/** design.md §7.1. 구현체: LlamaCppLlm, FakeLlm, ReplayLlm. */
export interface LlmPort {
  generate(req: LlmRequest): Promise<LlmResponse>
}

export class LlmUnavailableError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'LlmUnavailableError'
  }
}
