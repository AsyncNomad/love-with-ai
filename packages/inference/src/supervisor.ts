import { spawn, type ChildProcess } from 'node:child_process'
import type { GpuKind, GpuLease } from '@heart/agents'


/** 프로세스를 관리하지 않는 모드(FakeLlm, 외부 llama-server). 상호 배제만 한다. */
export class PassthroughLease implements GpuLease {
  private chain: Promise<unknown> = Promise.resolve()

  use<T>(_kind: GpuKind, fn: () => Promise<T>): Promise<T> {
    const run = this.chain.then(fn, fn)
    this.chain = run.catch(() => undefined)
    return run
  }
}

export interface ManagedProcess {
  ensureStarted(): Promise<void>
  stop(): Promise<void>
}

/**
 * 종류가 바뀔 때만 프로세스를 교대한다. image로 넘어가면 llama-server를 내려 VRAM을 비운다.
 * 이미지 쪽은 CLI를 장마다 띄우므로 상주 프로세스가 없다.
 */
export class ProcessGpuLease implements GpuLease {
  private chain: Promise<unknown> = Promise.resolve()
  private current: GpuKind | null = null

  constructor(private readonly llm: ManagedProcess) {}

  use<T>(kind: GpuKind, fn: () => Promise<T>): Promise<T> {
    const run = this.chain.then(async () => {
      if (this.current !== kind) {
        if (kind === 'image') await this.llm.stop()
        else await this.llm.ensureStarted()
        this.current = kind
      }
      return fn()
    })
    this.chain = run.catch(() => undefined)
    return run
  }

  async shutdown(): Promise<void> {
    await this.llm.stop()
    this.current = null
  }
}

export interface LlamaServerOptions {
  binary: string
  model: string
  host: string
  port: number
  contextSize: number
  gpuLayers: number
  parallel: number
  extraArgs?: string[]
  startupTimeoutMs: number
  health: () => Promise<boolean>
  log?: (line: string) => void
}

/** `llama-server`를 띄우고 /health가 200이 될 때까지 기다린다. */
export class LlamaServerProcess implements ManagedProcess {
  private child: ChildProcess | null = null

  constructor(private readonly opts: LlamaServerOptions) {}

  async ensureStarted(): Promise<void> {
    if (this.child && this.child.exitCode === null) return
    if (await this.opts.health()) return
    const o = this.opts
    const args = [
      '-m', o.model,
      '-ngl', String(o.gpuLayers),
      '-c', String(o.contextSize),
      '-np', String(o.parallel),
      '--jinja',
      '--host', o.host,
      '--port', String(o.port),
      ...(o.extraArgs ?? []),
    ]
    const child = spawn(o.binary, args, { stdio: ['ignore', 'ignore', 'pipe'] })
    this.child = child
    child.stderr?.on('data', (d: Buffer) => o.log?.(d.toString().trimEnd()))
    const deadline = Date.now() + o.startupTimeoutMs
    while (Date.now() < deadline) {
      if (child.exitCode !== null) throw new Error(`llama-server exited early with code ${child.exitCode}`)
      if (await o.health()) return
      await new Promise((r) => setTimeout(r, 500))
    }
    await this.stop()
    throw new Error('llama-server did not become healthy in time')
  }

  async stop(): Promise<void> {
    const child = this.child
    this.child = null
    if (!child || child.exitCode !== null) return
    await new Promise<void>((resolve) => {
      const force = setTimeout(() => child.kill('SIGKILL'), 10_000)
      child.once('exit', () => {
        clearTimeout(force)
        resolve()
      })
      child.kill('SIGTERM')
    })
  }
}
