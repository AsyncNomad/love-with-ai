export interface ImageRequest {
  prompt: string
  seed: number
  width: number
  height: number
  steps: number
  signal?: AbortSignal
}

/** design.md §8.3-6. 구현체: SdCppImage, FakeImage. */
export interface ImagePort {
  generate(req: ImageRequest): Promise<Uint8Array>
}

export type GpuKind = 'llm' | 'image'

/** design.md D27: 한 번에 한 쪽만 GPU를 쓴다. 종류가 바뀔 때 구현체가 프로세스를 교대한다. */
export interface GpuLease {
  use<T>(kind: GpuKind, fn: () => Promise<T>): Promise<T>
}
