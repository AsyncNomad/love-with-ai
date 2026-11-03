import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * 서버 설정(design.md D27, D32). 플레이 서버는 항상 실제 모델(GPU)로만 돈다. 모드는 하나다.
 * 필요한 실행 파일·모델이 없으면 `missing`에 담기고, 서버는 설치 방법을 알려 준 뒤 시작하지 않는다.
 * 가짜 모델(FakeLlm)은 자동 테스트와 헤드리스 시뮬레이션(`npm run sim`)에서만 쓴다.
 * 모든 서버는 127.0.0.1에만 바인딩한다(로컬 전용).
 */
export interface ServerEnv {
  port: number
  host: string
  runsDir: string
  webDist: string
  timeScale: number
  llamaUrl: string
  llamaBin: string
  llamaModel: string
  llamaPort: number
  contextSize: number
  sdBin: string
  sdDiffusionModel: string
  sdVae: string
  sdTextEncoder: string
  sdExtraArgs: string[]
  llamaExtraArgs: string[]
  /** 없는 필수 파일과 설치 명령 */
  missing: { path: string; fix: string }[]
  /** 서버 시작 로그에 남길 안내 */
  notes: string[]
}

/** 최소 사양(VRAM 8GB)의 기본 컨텍스트(D26). */
export const DEFAULT_CONTEXT = 102_400
/** VRAM이 최소 사양보다 작을 때 쓰는 컨텍스트. 최소 사양 미만은 지원 대상이 아니지만 실행은 되게 한다. */
const SMALL_GPU_CONTEXT = 32_768

function splitArgs(value: string | undefined): string[] {
  return value ? value.trim().split(/\s+/).filter(Boolean) : []
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

  const missing = [
    ...[llamaBin, llamaModel].map((path) => ({ path, fix: 'npm run setup:llm' })),
    ...[sdBin, sdDiffusionModel, sdVae, sdTextEncoder].map((path) => ({ path, fix: 'npm run setup:image' })),
  ].filter((m) => !existsSync(m.path))

  let contextSize = Number(env.LLAMA_CTX ?? 0)
  if (!contextSize) {
    contextSize = DEFAULT_CONTEXT
    const vram = gpuTotalMiB()
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
    llamaUrl: `http://127.0.0.1:${llamaPort}`,
    llamaBin,
    llamaModel,
    llamaPort,
    contextSize,
    sdBin,
    sdDiffusionModel,
    sdVae,
    sdTextEncoder,
    sdExtraArgs: splitArgs(env.SD_EXTRA_ARGS),
    llamaExtraArgs: splitArgs(env.LLAMA_EXTRA_ARGS),
    missing,
    notes,
  }
}
