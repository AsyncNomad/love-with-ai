import type { FakeResponder, LlmPort, LlmRequest, LlmResponse } from '@heart/agents'
import type { Rng } from '@heart/engine'

export type Sleep = (ms: number, signal?: AbortSignal) => Promise<void>

export interface FakeLlmOptions {
  rng: Rng
  responders: Record<string, FakeResponder>
  latencyMs: { min: number; max: number }
  sleep: Sleep
}

/** GPU 없이 도는 결정적 LLM(D17). 응답기가 없는 작업은 JSON Schema에서 값을 만들어 낸다. */
export class FakeLlm implements LlmPort {
  calls = 0

  constructor(private readonly opts: FakeLlmOptions) {}

  async generate(req: LlmRequest): Promise<LlmResponse> {
    this.calls++
    const { min, max } = this.opts.latencyMs
    await this.opts.sleep(this.opts.rng.int(min, max), req.signal)
    if (req.signal?.aborted) throw abortError()
    const responder = this.opts.responders[req.task]
    const value = responder ? responder(req, this.opts.rng) : fromSchema(req.jsonSchema, this.opts.rng)
    const content = JSON.stringify(value)
    return { content, promptTokens: Math.ceil(req.messages.reduce((s, m) => s + m.content.length, 0) / 1.5), completionTokens: Math.ceil(content.length / 1.5) }
  }
}

function abortError(): Error {
  const err = new Error('aborted')
  err.name = 'AbortError'
  return err
}

/** 최소한의 JSON Schema 기반 값 생성기. */
export function fromSchema(schema: Record<string, unknown>, rng: Rng): unknown {
  if (Array.isArray(schema.enum)) return rng.pick(schema.enum)
  if ('const' in schema) return schema.const
  const anyOf = (schema.anyOf ?? schema.oneOf) as Record<string, unknown>[] | undefined
  if (anyOf && anyOf.length > 0) return fromSchema(rng.pick(anyOf), rng)
  switch (schema.type) {
    case 'object': {
      const props = (schema.properties ?? {}) as Record<string, Record<string, unknown>>
      return Object.fromEntries(Object.entries(props).map(([k, v]) => [k, fromSchema(v, rng)]))
    }
    case 'array': {
      const min = typeof schema.minItems === 'number' ? schema.minItems : 0
      const max = typeof schema.maxItems === 'number' ? schema.maxItems : Math.max(min, 2)
      const items = (schema.items ?? {}) as Record<string, unknown>
      return Array.from({ length: rng.int(min, max) }, () => fromSchema(items, rng))
    }
    case 'boolean':
      return rng.chance(0.5)
    case 'integer':
    case 'number': {
      const lo = typeof schema.minimum === 'number' ? schema.minimum : 0
      const hi = typeof schema.maximum === 'number' ? schema.maximum : 10
      return rng.int(lo, hi)
    }
    default:
      return '테스트'
  }
}
