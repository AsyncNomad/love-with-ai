import type { SamplingConfig } from '@signal/shared'

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

export interface LlmResponse {
  content: string
  promptTokens: number | null
  completionTokens: number | null
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
