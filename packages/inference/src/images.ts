import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { deflateSync } from 'node:zlib'
import type { ImagePort, ImageRequest } from '@heart/agents'


export interface SdCppOptions {
  binary: string
  diffusionModel: string
  vae: string
  textEncoder: string
  timeoutMs: number
  extraArgs?: string[]
}

/**
 * stable-diffusion.cpp CLI로 FLUX.2 [klein] 4B를 돌린다(D22).
 * 장마다 프로세스를 띄운다. 상주 서버 모드는 Phase 1에서 확인한 뒤 구현체를 하나 더 둔다.
 * 플래그는 stable-diffusion.cpp docs/flux2.md 기준이며 Phase 1에서 실측 확인한다.
 */
export class SdCppImage implements ImagePort {
  constructor(private readonly opts: SdCppOptions) {}

  async generate(req: ImageRequest): Promise<Uint8Array> {
    const dir = await mkdtemp(join(tmpdir(), 'heart-sd-'))
    const out = join(dir, 'out.png')
    const args = [
      '--diffusion-model', this.opts.diffusionModel,
      '--vae', this.opts.vae,
      '--llm', this.opts.textEncoder,
      '-p', req.prompt,
      '--cfg-scale', '1.0',
      '--steps', String(req.steps),
      '-W', String(req.width),
      '-H', String(req.height),
      '-s', String(req.seed),
      '-o', out,
      ...(this.opts.extraArgs ?? []),
    ]
    try {
      await runProcess(this.opts.binary, args, this.opts.timeoutMs, req.signal)
      return new Uint8Array(await readFile(out))
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }
}

function runProcess(bin: string, args: string[], timeoutMs: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ['ignore', 'ignore', 'pipe'] })
    let stderr = ''
    child.stderr.on('data', (d: Buffer) => {
      stderr = (stderr + d.toString()).slice(-2000)
    })
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs)
    const onAbort = (): void => {
      child.kill('SIGKILL')
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    child.on('error', (err) => {
      clearTimeout(timer)
      reject(err)
    })
    child.on('exit', (code) => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      if (code === 0) resolve()
      else reject(new Error(`${bin} exited with ${code}: ${stderr}`))
    })
  })
}

/** 시드에 따라 색이 달라지는 그라디언트 PNG. 실제 모델 없이 UI와 파이프라인을 검증한다. */
export class FakeImage implements ImagePort {
  async generate(req: ImageRequest): Promise<Uint8Array> {
    const size = 64
    const hue = req.seed % 360
    const [r1, g1, b1] = hsl(hue, 0.55, 0.78)
    const [r2, g2, b2] = hsl((hue + 40) % 360, 0.6, 0.62)
    const raw = Buffer.alloc((size * 3 + 1) * size)
    for (let y = 0; y < size; y++) {
      raw[y * (size * 3 + 1)] = 0
      for (let x = 0; x < size; x++) {
        const t = (x + y) / (2 * size)
        const o = y * (size * 3 + 1) + 1 + x * 3
        raw[o] = Math.round(r1 + (r2 - r1) * t)
        raw[o + 1] = Math.round(g1 + (g2 - g1) * t)
        raw[o + 2] = Math.round(b1 + (b2 - b1) * t)
      }
    }
    return encodePng(size, size, raw)
  }
}

function hsl(h: number, s: number, l: number): [number, number, number] {
  const a = s * Math.min(l, 1 - l)
  const f = (n: number): number => {
    const k = (n + h / 30) % 12
    return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))))
  }
  return [f(0), f(8), f(4)]
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})

function crc32(buf: Buffer): number {
  let c = 0xffffffff
  for (const byte of buf) c = (CRC_TABLE[(c ^ byte) & 0xff] as number) ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(td))
  return Buffer.concat([len, td, crc])
}

function encodePng(width: number, height: number, raw: Buffer): Uint8Array {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 2
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  return new Uint8Array(Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]))
}
