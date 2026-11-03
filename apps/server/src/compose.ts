import { mkdirSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { GpuLease, ImagePort, LlmPort } from '@heart/agents'
import { LlamaCppLlm, LlamaServerProcess, ProcessGpuLease, SdCppImage } from '@heart/inference'
import type { AvatarStore } from '@heart/runtime'
import type { ServerEnv } from './env'

export interface Inference {
  llm: LlmPort
  lease: GpuLease
  image: ImagePort
  shutdown(): Promise<void>
}

/**
 * 플레이용 추론 구성(D27, D32): 게임 서버가 llama-server를 직접 띄우고, 사진을 만들 때 GPU를 교대한다.
 * 모드는 하나다. 가짜 모델은 테스트·시뮬레이션(sim.ts)에서만 조립한다.
 */
export function buildInference(env: ServerEnv, requestTimeoutMs: number, log: (line: string) => void): Inference {
  const llm = new LlamaCppLlm({ baseUrl: env.llamaUrl, timeoutMs: requestTimeoutMs })
  mkdirSync(env.runsDir, { recursive: true })
  const proc = new LlamaServerProcess({
    binary: env.llamaBin,
    model: env.llamaModel,
    host: '127.0.0.1',
    port: env.llamaPort,
    contextSize: env.contextSize,
    cacheRamMiB: env.cacheRamMiB,
    gpuLayers: 99,
    parallel: 1,
    startupTimeoutMs: 120_000,
    extraArgs: env.llamaExtraArgs,
    health: () => llm.health(),
    pidFile: join(env.runsDir, '.llama-server.pid'),
    log: (line) => log(`[llama-server] ${line}`),
  })
  const lease = new ProcessGpuLease(proc)
  const image = new SdCppImage({
    binary: env.sdBin,
    diffusionModel: env.sdDiffusionModel,
    vae: env.sdVae,
    textEncoder: env.sdTextEncoder,
    timeoutMs: 180_000,
    extraArgs: env.sdExtraArgs,
  })
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
