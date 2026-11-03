import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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
  /**
   * 호스트 RAM 프롬프트 캐시 상한(MiB, `--cache-ram`). llama.cpp 기본값은 8192라서, 3일을 도는 동안
   * 캐시가 계속 쌓여 RAM 16GB PC의 WSL 몫(약 8GB)을 다 쓴다(실측, docs/status.md). 0이면 끈다.
   */
  cacheRamMiB: number
  gpuLayers: number
  parallel: number
  extraArgs?: string[]
  startupTimeoutMs: number
  health: () => Promise<boolean>
  /** 띄운 프로세스의 PID를 기록한다. 게임 서버가 비정상 종료해 llama-server가 남아도 다음 실행이 이어받아 내릴 수 있다. */
  pidFile: string
  log?: (line: string) => void
}

function isLlamaServer(pid: number): boolean {
  try {
    return readFileSync(`/proc/${pid}/cmdline`, 'utf8').includes('llama-server')
  } catch {
    return false
  }
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/**
 * `llama-server`를 띄우고 /health가 200이 될 때까지 기다린다.
 * 포트에 이미 떠 있는 서버가 이전에 우리가 띄운 것(PID 파일)이면 이어받는다. 모르는 서버면 거부한다.
 * 내리지 못하는 서버를 쓰면 GPU 교대가 조용히 실패하기 때문이다(실측: 사진 생성이 VRAM 부족 상태로 돌았다).
 */
export class LlamaServerProcess implements ManagedProcess {
  private child: ChildProcess | null = null
  private adoptedPid: number | null = null

  constructor(private readonly opts: LlamaServerOptions) {}

  async ensureStarted(): Promise<void> {
    if (this.child && this.child.exitCode === null) return
    if (this.adoptedPid !== null && isAlive(this.adoptedPid)) return
    const o = this.opts
    if (await o.health()) {
      const pid = this.readPid()
      if (pid !== null && isLlamaServer(pid)) {
        this.adoptedPid = pid
        o.log?.(`adopted running llama-server pid ${pid}`)
        return
      }
      throw new Error(
        `port ${o.port} is already served by a llama-server this app did not start; stop it and start the game server again`,
      )
    }
    const args = [
      '-m', o.model,
      '-ngl', String(o.gpuLayers),
      '-c', String(o.contextSize),
      '--cache-ram', String(o.cacheRamMiB),
      '-np', String(o.parallel),
      '--jinja',
      '--host', o.host,
      '--port', String(o.port),
      ...(o.extraArgs ?? []),
    ]
    const child = spawn(o.binary, args, { stdio: ['ignore', 'ignore', 'pipe'] })
    this.child = child
    if (child.pid !== undefined) writeFileSync(o.pidFile, String(child.pid))
    child.once('exit', () => this.clearPid(child.pid))
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
    if (child && child.exitCode === null) {
      await new Promise<void>((resolve) => {
        const force = setTimeout(() => child.kill('SIGKILL'), 10_000)
        child.once('exit', () => {
          clearTimeout(force)
          resolve()
        })
        child.kill('SIGTERM')
      })
    }
    const adopted = this.adoptedPid
    this.adoptedPid = null
    if (adopted !== null && isAlive(adopted)) {
      process.kill(adopted, 'SIGTERM')
      const deadline = Date.now() + 10_000
      while (isAlive(adopted) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 200))
      if (isAlive(adopted)) process.kill(adopted, 'SIGKILL')
      this.clearPid(adopted)
    }
  }

  private readPid(): number | null {
    if (!existsSync(this.opts.pidFile)) return null
    const pid = Number(readFileSync(this.opts.pidFile, 'utf8').trim())
    return Number.isInteger(pid) && pid > 0 ? pid : null
  }

  private clearPid(pid: number | undefined): void {
    if (pid !== undefined && this.readPid() === pid) rmSync(this.opts.pidFile, { force: true })
  }
}
