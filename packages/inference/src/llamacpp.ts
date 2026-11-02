import { LlmUnavailableError, type LlmPort, type LlmRequest, type LlmResponse } from '@heart/agents'

export interface LlamaCppOptions {
  baseUrl: string
  timeoutMs: number
  model?: string
  fetchImpl?: typeof fetch
}

interface ChatCompletion {
  choices?: { message?: { content?: string } }[]
  usage?: { prompt_tokens?: number; completion_tokens?: number }
}

/**
 * llama-server의 OpenAI 호환 API(design.md §7.1).
 * thinking은 요청마다 끈다(D5). 출력은 JSON Schema로 제약한다.
 */
export class LlamaCppLlm implements LlmPort {
  private readonly fetchImpl: typeof fetch

  constructor(private readonly opts: LlamaCppOptions) {
    this.fetchImpl = opts.fetchImpl ?? fetch
  }

  async generate(req: LlmRequest): Promise<LlmResponse> {
    const signals = [AbortSignal.timeout(this.opts.timeoutMs), ...(req.signal ? [req.signal] : [])]
    const body = {
      model: this.opts.model ?? 'local',
      messages: req.messages,
      max_tokens: req.maxTokens,
      temperature: req.sampling.temperature,
      top_p: req.sampling.topP,
      top_k: req.sampling.topK,
      min_p: req.sampling.minP,
      presence_penalty: req.sampling.presencePenalty,
      stream: false,
      response_format: { type: 'json_schema', json_schema: { name: req.task, strict: true, schema: req.jsonSchema } },
      chat_template_kwargs: { enable_thinking: false },
    }
    let res: Response
    try {
      res = await this.fetchImpl(`${this.opts.baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.any(signals),
      })
    } catch (err) {
      if (err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError')) throw err
      throw new LlmUnavailableError(`llama-server unreachable at ${this.opts.baseUrl}`, { cause: err })
    }
    if (res.status === 503) throw new LlmUnavailableError('llama-server is loading or overloaded (503)')
    if (!res.ok) throw new Error(`llama-server HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`)
    const data = (await res.json()) as ChatCompletion
    const content = data.choices?.[0]?.message?.content
    if (typeof content !== 'string') throw new Error('llama-server returned no content')
    return {
      content,
      promptTokens: data.usage?.prompt_tokens ?? null,
      completionTokens: data.usage?.completion_tokens ?? null,
    }
  }

  async health(): Promise<boolean> {
    try {
      const res = await this.fetchImpl(`${this.opts.baseUrl}/health`, { signal: AbortSignal.timeout(2_000) })
      return res.ok
    } catch {
      return false
    }
  }
}
