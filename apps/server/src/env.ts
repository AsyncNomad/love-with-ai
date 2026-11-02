import { resolve } from 'node:path'

/**
 * 서버 설정(design.md D27). 기본값은 GPU 없이 도는 fake 모드다.
 * 모든 서버는 127.0.0.1에만 바인딩한다(로컬 전용).
 */
export interface ServerEnv {
  port: number
  host: string
  runsDir: string
  webDist: string
  timeScale: number
  llmMode: 'fake' | 'llamacpp' | 'external'
  llamaUrl: string
  llamaBin: string
  llamaModel: string
  llamaPort: number
  contextSize: number
  imageMode: 'fake' | 'sdcpp' | 'off'
  sdBin: string
  sdDiffusionModel: string
  sdVae: string
  sdTextEncoder: string
  sdExtraArgs: string[]
  llamaExtraArgs: string[]
  fakeLatencyMs: { min: number; max: number }
}

function splitArgs(value: string | undefined): string[] {
  return value ? value.trim().split(/\s+/).filter(Boolean) : []
}

function pick<T extends string>(value: string | undefined, allowed: readonly T[], fallback: T): T {
  return value && (allowed as readonly string[]).includes(value) ? (value as T) : fallback
}

export function readEnv(env: NodeJS.ProcessEnv = process.env, root = resolve(import.meta.dirname, '../../..')): ServerEnv {
  const llamaPort = Number(env.LLAMA_PORT ?? 8080)
  const llmMode = pick(env.LLM_MODE, ['fake', 'llamacpp', 'external'] as const, 'fake')
  return {
    port: Number(env.PORT ?? 8787),
    host: '127.0.0.1',
    runsDir: resolve(root, env.RUNS_DIR ?? 'runs'),
    webDist: resolve(root, 'apps/web/dist'),
    timeScale: Number(env.TIME_SCALE ?? 1),
    llmMode,
    llamaUrl: env.LLM_EXTERNAL_URL ?? `http://127.0.0.1:${llamaPort}`,
    llamaBin: resolve(root, env.LLAMA_BIN ?? 'bin/llama-server'),
    llamaModel: resolve(root, env.LLAMA_MODEL ?? 'models/Qwen3.5-4B-Q4_K_M.gguf'),
    llamaPort,
    contextSize: Number(env.LLAMA_CTX ?? 102_400),
    imageMode: pick(env.IMAGE_MODE, ['fake', 'sdcpp', 'off'] as const, llmMode === 'fake' ? 'fake' : 'off'),
    sdBin: resolve(root, env.SD_BIN ?? 'bin/sd-cli'),
    sdDiffusionModel: resolve(root, env.SD_DIFFUSION_MODEL ?? 'models/flux-2-klein-4b-Q4_0.gguf'),
    sdVae: resolve(root, env.SD_VAE ?? 'models/flux2-small-decoder.safetensors'),
    sdTextEncoder: resolve(root, env.SD_TEXT_ENCODER ?? 'models/Qwen3-4B-Q4_K_M.gguf'),
    sdExtraArgs: splitArgs(env.SD_EXTRA_ARGS),
    llamaExtraArgs: splitArgs(env.LLAMA_EXTRA_ARGS),
    fakeLatencyMs: { min: Number(env.FAKE_LATENCY_MIN ?? 600), max: Number(env.FAKE_LATENCY_MAX ?? 1800) },
  }
}
