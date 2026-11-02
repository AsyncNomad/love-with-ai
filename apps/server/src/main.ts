import { randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import { createReadStream } from 'node:fs'
import { join } from 'node:path'
import fastifyStatic from '@fastify/static'
import fastifyWebsocket from '@fastify/websocket'
import Fastify from 'fastify'
import type { WebSocket } from 'ws'
import { defaultConfig, withTimeScale } from '@signal/config'
import { Game, realTimerHost } from '@signal/runtime'
import { clientMessageSchema, emptyHumanView, type ServerMessage, type ViewPatch } from '@signal/shared'
import { SqliteRunStore } from '@signal/store'
import { FsAvatarStore, buildInference } from './compose'
import { readEnv } from './env'

const env = readEnv()
const config = withTimeScale(defaultConfig, env.timeScale)
const app = Fastify({ logger: { level: 'info' } })
const inference = buildInference(env, config.llm.requestTimeoutMs, (line) => app.log.debug(line))
const avatars = new FsAvatarStore(env.runsDir)

interface ActiveRun {
  game: Game
  store: SqliteRunStore
}

let active: ActiveRun | null = null
const clients = new Map<WebSocket, () => void>()

function send(ws: WebSocket, msg: ServerMessage): void {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg))
}

function attach(ws: WebSocket): void {
  clients.get(ws)?.()
  if (!active) {
    clients.set(ws, () => {})
    send(ws, { type: 'snapshot', view: emptyHumanView() })
    return
  }
  const game = active.game
  const unsub = game.projector.subscribe((patches: ViewPatch[]) => send(ws, { type: 'patch', patches }))
  clients.set(ws, unsub)
  send(ws, { type: 'snapshot', view: game.projector.snapshot() })
}

function newRunId(): string {
  const d = new Date()
  const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}-${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}${String(d.getSeconds()).padStart(2, '0')}`
  return `run_${stamp}_${randomBytes(2).toString('hex')}`
}

function startRun(profile: Parameters<Game['start']>[0]): void {
  active?.store.close()
  const runId = newRunId()
  const store = new SqliteRunStore(join(env.runsDir, runId, 'run.sqlite'), runId)
  const game = new Game({
    runId,
    seed: randomBytes(8).toString('hex'),
    config,
    sink: store,
    llm: inference.llm,
    lease: inference.lease,
    image: inference.image,
    avatars,
    host: realTimerHost,
  })
  active = { game, store }
  for (const ws of clients.keys()) attach(ws)
  app.log.info({ runId }, 'run started')
  game.start(profile).then(
    () => app.log.info({ runId }, 'run finished'),
    (err: unknown) => {
      app.log.error({ err, runId }, 'run crashed')
      if (game.session.state.status !== 'completed') {
        game.session.commit({ type: 'RUN_COMPLETED', payload: { reason: 'crashed' }, visibility: { kind: 'house' } })
      }
    },
  )
}

await app.register(fastifyWebsocket)

app.get('/ws', { websocket: true }, (socket) => {
  attach(socket)
  active?.game.humanConnected()
  socket.on('message', (raw: Buffer) => {
    let parsed
    try {
      parsed = clientMessageSchema.safeParse(JSON.parse(raw.toString()))
    } catch {
      return
    }
    if (!parsed.success) return
    const msg = parsed.data
    if (msg.type === 'hello') {
      attach(socket)
      return
    }
    const { commandId, command } = msg
    if (command.type === 'createRun') {
      if (active && active.game.session.state.status !== 'completed') {
        send(socket, { type: 'ack', commandId, ok: false, error: 'run_in_progress' })
        return
      }
      startRun(command.profile)
      send(socket, { type: 'ack', commandId, ok: true })
      return
    }
    if (!active) {
      send(socket, { type: 'ack', commandId, ok: false, error: 'no_run' })
      return
    }
    const result = active.game.handle(commandId, command)
    send(socket, result.ok ? { type: 'ack', commandId, ok: true } : { type: 'ack', commandId, ok: false, error: result.error })
  })
  socket.on('close', () => {
    clients.get(socket)?.()
    clients.delete(socket)
    if (clients.size === 0) active?.game.humanDisconnected()
  })
})

app.get<{ Params: { runId: string; file: string } }>('/avatars/:runId/:file', (req, reply) => {
  const { runId, file } = req.params
  if (!/^run_[\w-]+$/.test(runId) || !/^p_\d{2}\.png$/.test(file)) return reply.code(404).send()
  const path = join(env.runsDir, runId, 'avatars', file)
  if (!existsSync(path)) return reply.code(404).send()
  return reply.type('image/png').header('cache-control', 'max-age=31536000, immutable').send(createReadStream(path))
})

if (existsSync(env.webDist)) {
  await app.register(fastifyStatic, { root: env.webDist })
}

const shutdown = async (): Promise<void> => {
  await app.close()
  active?.store.close()
  await inference.shutdown()
  process.exit(0)
}
process.on('SIGINT', () => void shutdown())
process.on('SIGTERM', () => void shutdown())

await app.listen({ port: env.port, host: env.host })
app.log.info(`SIGNAL HOUSE server on http://${env.host}:${env.port} (llm=${env.llmMode}, image=${env.imageMode}, timeScale=${env.timeScale})`)
