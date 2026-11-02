import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fakeResponders, type GpuLease, type ImagePort, type LlmPort } from '@heart/agents'
import { createRng } from '@heart/engine'
import { FakeImage, FakeLlm, LlamaCppLlm, LlamaServerProcess, PassthroughLease, ProcessGpuLease, SdCppImage } from '@heart/inference'
import type { AvatarStore } from '@heart/runtime'
import type { ServerEnv } from './env'

export interface Inference {
  llm: LlmPort
  lease: GpuLease
  image: ImagePort | null
  shutdown(): Promise<void>
}

const realSleep = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms)
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(t)
        const err = new Error('aborted')
        err.name = 'AbortError'
        reject(err)
      },
      { once: true },
    )
  })

/** 설정에 맞는 추론 구성(D27). */
export function buildInference(env: ServerEnv, requestTimeoutMs: number, log: (line: string) => void): Inference {
  if (env.llmMode === 'fake') {
    return {
      llm: new FakeLlm({ rng: createRng(`fake-${Date.now()}`), responders: fakeResponders, latencyMs: env.fakeLatencyMs, sleep: realSleep }),
      lease: new PassthroughLease(),
      image: env.imageMode === 'fake' ? new FakeImage() : null,
      shutdown: async () => {},
    }
  }
  const llm = new LlamaCppLlm({ baseUrl: env.llamaUrl, timeoutMs: requestTimeoutMs })
  if (env.llmMode === 'external') {
    // 외부 llama-server는 내릴 수 없으므로 사진 생성을 건너뛴다(D27).
    return { llm, lease: new PassthroughLease(), image: null, shutdown: async () => {} }
  }
  const proc = new LlamaServerProcess({
    binary: env.llamaBin,
    model: env.llamaModel,
    host: '127.0.0.1',
    port: env.llamaPort,
    contextSize: env.contextSize,
    gpuLayers: 99,
    parallel: 1,
    startupTimeoutMs: 120_000,
    extraArgs: env.llamaExtraArgs,
    health: () => llm.health(),
    log: (line) => log(`[llama-server] ${line}`),
  })
  const lease = new ProcessGpuLease(proc)
  const image =
    env.imageMode === 'sdcpp'
      ? new SdCppImage({ binary: env.sdBin, diffusionModel: env.sdDiffusionModel, vae: env.sdVae, textEncoder: env.sdTextEncoder, timeoutMs: 180_000, extraArgs: env.sdExtraArgs })
      : env.imageMode === 'fake'
        ? new FakeImage()
        : null
  return { llm, lease, image, shutdown: () => lease.shutdown() }
}

/** runs/<run_id>/avatars/<participant_id>.png 에 저장한다(design.md §8.3-4). */
export class FsAvatarStore implements AvatarStore {
  constructor(private readonly runsDir: string) {}

  async save(runId: string, participantId: string, png: Uint8Array): Promise<string> {
    const dir = join(this.runsDir, runId, 'avatars')
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, `${participantId}.png`), png)
    return `/avatars/${runId}/${participantId}.png`
  }
}
