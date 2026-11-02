import type { ClientMessage, Command, HumanView, ServerMessage, ViewPatch } from '@signal/shared'

export type ConnectionStatus = 'connecting' | 'open' | 'closed'

export interface ConnectionHandlers {
  onSnapshot(view: HumanView): void
  onPatches(patches: ViewPatch[]): void
  onStatus(status: ConnectionStatus): void
}

export interface CommandAck {
  ok: boolean
  error?: string
}

/** 서버 WebSocket 연결. 끊기면 지수 백오프로 다시 붙고, 붙을 때마다 서버가 스냅샷을 다시 보낸다. */
export class GameConnection {
  private ws: WebSocket | null = null
  private counter = 0
  private retryMs = 500
  private closedByUser = false
  private readonly pending = new Map<string, (ack: CommandAck) => void>()

  constructor(
    private readonly url: string,
    private readonly handlers: ConnectionHandlers,
  ) {}

  connect(): void {
    this.closedByUser = false
    this.handlers.onStatus('connecting')
    const ws = new WebSocket(this.url)
    this.ws = ws
    ws.onopen = () => {
      this.retryMs = 500
      this.handlers.onStatus('open')
      this.raw({ type: 'hello' })
    }
    ws.onmessage = (ev: MessageEvent<string>) => this.onMessage(ev.data)
    ws.onclose = () => {
      this.handlers.onStatus('closed')
      for (const resolve of this.pending.values()) resolve({ ok: false, error: 'disconnected' })
      this.pending.clear()
      if (!this.closedByUser) {
        setTimeout(() => this.connect(), this.retryMs)
        this.retryMs = Math.min(this.retryMs * 2, 5_000)
      }
    }
  }

  close(): void {
    this.closedByUser = true
    this.ws?.close()
  }

  send(command: Command): Promise<CommandAck> {
    const commandId = `${Date.now().toString(36)}-${++this.counter}`
    return new Promise((resolve) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return resolve({ ok: false, error: 'offline' })
      this.pending.set(commandId, resolve)
      this.raw({ type: 'command', commandId, command })
    })
  }

  private raw(msg: ClientMessage): void {
    this.ws?.send(JSON.stringify(msg))
  }

  private onMessage(data: string): void {
    let msg: ServerMessage
    try {
      msg = JSON.parse(data) as ServerMessage
    } catch {
      return
    }
    switch (msg.type) {
      case 'snapshot':
        this.handlers.onSnapshot(msg.view)
        break
      case 'patch':
        this.handlers.onPatches(msg.patches)
        break
      case 'ack': {
        const resolve = this.pending.get(msg.commandId)
        this.pending.delete(msg.commandId)
        resolve?.({ ok: msg.ok, ...(msg.error ? { error: msg.error } : {}) })
        break
      }
    }
  }
}
