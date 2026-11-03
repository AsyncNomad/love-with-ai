import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * 서버 설정(design.md D27). 모든 서버는 127.0.0.1에만 바인딩한다(로컬 전용).
 *
 * 기본은 자동이다. `bin/`과 `models/`에 실행 파일과 모델이 있으면 실제 모델(llama.cpp, sd.cpp)로,
 * 없으면 GPU 없이 도는 fake 모드로 시작한다. fake로 돌 때는 화면에 "테스트 모드"가 표시된다.
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
  /** 자동 결정 과정에서 남길 안내(서버 시작 로그에 출력). */
  notes: string[]
}

/** 최소 사양(VRAM 8GB)의 기본 컨텍스트(D26). */
export const DEFAULT_CONTEXT = 102_400
/** VRAM이 최소 사양보다 작을 때 쓰는 컨텍스트. 최소 사양 미만은 지원 대상이 아니지만 테스트용으로 돌게 한다. */
const SMALL_GPU_CONTEXT = 32_768

function splitArgs(value: string | undefined): string[] {
  return value ? value.trim().split(/\s+/).filter(Boolean) : []
}

function pick<T extends string>(value: string | undefined, allowed: readonly T[], fallback: T): T {
  return value && (allowed as readonly string[]).includes(value) ? (value as T) : fallback
}

function gpuTotalMiB(): number | null {
  try {
    const out = execFileSync('nvidia-smi', ['--query-gpu=memory.total', '--format=csv,noheader,nounits'], { encoding: 'utf8', timeout: 5_000 })
    const n = Number(out.trim().split('\n')[0])
    return Number.isFinite(n) && n > 0 ? n : null
  } catch {
    return null
  }
}

export function readEnv(env: NodeJS.ProcessEnv = process.env, root = resolve(import.meta.dirname, '../../..')): ServerEnv {
  const notes: string[] = []
  const llamaPort = Number(env.LLAMA_PORT ?? 8080)
  const llamaBin = resolve(root, env.LLAMA_BIN ?? 'bin/llama-server')
  const llamaModel = resolve(root, env.LLAMA_MODEL ?? 'models/Qwen3.5-4B-Q4_K_M.gguf')
  const sdBin = resolve(root, env.SD_BIN ?? 'bin/sd-cli')
  const sdDiffusionModel = resolve(root, env.SD_DIFFUSION_MODEL ?? 'models/flux-2-klein-4b-Q4_0.gguf')
  const sdVae = resolve(root, env.SD_VAE ?? 'models/flux2-small-decoder.safetensors')
  const sdTextEncoder = resolve(root, env.SD_TEXT_ENCODER ?? 'models/Qwen3-4B-Q4_K_M.gguf')

  const llmInstalled = existsSync(llamaBin) && existsSync(llamaModel)
  const imageInstalled = [sdBin, sdDiffusionModel, sdVae, sdTextEncoder].every((p) => existsSync(p))

  const requestedLlm = pick(env.LLM_MODE, ['auto', 'fake', 'llamacpp', 'external'] as const, 'auto')
  const llmMode = requestedLlm === 'auto' ? (llmInstalled ? 'llamacpp' : 'fake') : requestedLlm
  if (requestedLlm === 'auto' && !llmInstalled) notes.push('llama-server 또는 모델이 없어 테스트 모드(가짜 AI)로 시작합니다. npm run setup:llm 으로 설치하세요.')

  const requestedImage = pick(env.IMAGE_MODE, ['auto', 'fake', 'sdcpp', 'off'] as const, 'auto')
  const imageMode =
    requestedImage !== 'auto'
      ? requestedImage
      : llmMode === 'fake'
        ? 'fake'
        : llmMode === 'llamacpp' && imageInstalled
          ? 'sdcpp'
          : 'off'
  if (requestedImage === 'auto' && llmMode === 'llamacpp' && !imageInstalled) notes.push('사진 생성기 또는 모델이 없어 기본 아바타를 씁니다. npm run setup:image 로 설치하세요.')

  let contextSize = Number(env.LLAMA_CTX ?? 0)
  if (!contextSize) {
    contextSize = DEFAULT_CONTEXT
    const vram = llmMode === 'llamacpp' ? gpuTotalMiB() : null
    if (vram !== null && vram < 7_500) {
      contextSize = SMALL_GPU_CONTEXT
      notes.push(`GPU VRAM ${vram}MiB가 최소 사양(8GB)보다 작아 컨텍스트를 ${SMALL_GPU_CONTEXT}로 줄입니다.`)
    }
  }

  return {
    port: Number(env.PORT ?? 8787),
    host: '127.0.0.1',
    runsDir: resolve(root, env.RUNS_DIR ?? 'runs'),
    webDist: resolve(root, 'apps/web/dist'),
    timeScale: Number(env.TIME_SCALE ?? 1),
    llmMode,
    llamaUrl: env.LLM_EXTERNAL_URL ?? `http://127.0.0.1:${llamaPort}`,
    llamaBin,
    llamaModel,
    llamaPort,
    contextSize,
    imageMode,
    sdBin,
    sdDiffusionModel,
    sdVae,
    sdTextEncoder,
    sdExtraArgs: splitArgs(env.SD_EXTRA_ARGS),
    llamaExtraArgs: splitArgs(env.LLAMA_EXTRA_ARGS),
    fakeLatencyMs: { min: Number(env.FAKE_LATENCY_MIN ?? 600), max: Number(env.FAKE_LATENCY_MAX ?? 1800) },
    notes,
  }
}
