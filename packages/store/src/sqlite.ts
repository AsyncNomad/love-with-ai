import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import type { AnyEvent } from '@signal/shared'
import { EVENT_SCHEMA_VERSION, isEventType, parseEventPayload, visibilitySchema } from '@signal/shared'

export const STORE_SCHEMA_VERSION = 1

export interface DeliveryRow {
  callId: string
  ownerId: string | null
  task: string
  attempt: number
  seqAtCall: number
  eventSeqs: number[]
  memoryIds: string[]
  promptText: string
}

export interface CallRow {
  callId: string
  task: string
  ownerId: string | null
  attempt: number
  durationMs: number
  promptTokens: number | null
  completionTokens: number | null
  outcome: string
  issues: string[]
  error: string | null
}

const MIGRATIONS: string[] = [
  `CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
   CREATE TABLE events (
     seq INTEGER PRIMARY KEY,
     type TEXT NOT NULL,
     actor TEXT NOT NULL,
     visibility TEXT NOT NULL,
     payload TEXT NOT NULL,
     sim_time TEXT NOT NULL,
     wall_ms INTEGER NOT NULL,
     idempotency_key TEXT UNIQUE,
     schema_version INTEGER NOT NULL
   );
   CREATE TABLE deliveries (
     call_id TEXT PRIMARY KEY,
     owner_id TEXT,
     task TEXT NOT NULL,
     attempt INTEGER NOT NULL,
     seq_at_call INTEGER NOT NULL,
     event_seqs TEXT NOT NULL,
     memory_ids TEXT NOT NULL,
     prompt_text TEXT NOT NULL
   );
   CREATE TABLE llm_calls (
     call_id TEXT PRIMARY KEY,
     task TEXT NOT NULL,
     owner_id TEXT,
     attempt INTEGER NOT NULL,
     duration_ms INTEGER NOT NULL,
     prompt_tokens INTEGER,
     completion_tokens INTEGER,
     outcome TEXT NOT NULL,
     issues TEXT NOT NULL,
     error TEXT
   );`,
]

/**
 * 회차 하나 = SQLite 파일 하나(design.md §16). 이벤트가 진실의 원천이고(D6),
 * 나머지 상태는 메모리에서 fold로 만든다.
 */
export class SqliteRunStore {
  private readonly db: Database.Database
  private readonly insertEvent: Database.Statement
  private readonly insertDelivery: Database.Statement
  private readonly insertCall: Database.Statement

  constructor(
    readonly path: string,
    readonly runId: string,
  ) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true })
    this.db = new Database(path)
    this.db.pragma('journal_mode = WAL')
    this.db.pragma('synchronous = NORMAL')
    this.migrate()
    this.db.prepare('INSERT OR IGNORE INTO meta (key, value) VALUES (?, ?)').run('run_id', runId)
    this.insertEvent = this.db.prepare(
      'INSERT INTO events (seq, type, actor, visibility, payload, sim_time, wall_ms, idempotency_key, schema_version) VALUES (@seq, @type, @actor, @visibility, @payload, @simTime, @wallMs, @idempotencyKey, @schemaVersion)',
    )
    this.insertDelivery = this.db.prepare(
      'INSERT INTO deliveries (call_id, owner_id, task, attempt, seq_at_call, event_seqs, memory_ids, prompt_text) VALUES (@callId, @ownerId, @task, @attempt, @seqAtCall, @eventSeqs, @memoryIds, @promptText)',
    )
    this.insertCall = this.db.prepare(
      'INSERT INTO llm_calls (call_id, task, owner_id, attempt, duration_ms, prompt_tokens, completion_tokens, outcome, issues, error) VALUES (@callId, @task, @ownerId, @attempt, @durationMs, @promptTokens, @completionTokens, @outcome, @issues, @error)',
    )
  }

  private migrate(): void {
    this.db.exec('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)')
    const row = this.db.prepare('SELECT version FROM schema_version').get() as { version: number } | undefined
    let version = row?.version ?? 0
    if (!row) this.db.prepare('INSERT INTO schema_version (version) VALUES (0)').run()
    while (version < MIGRATIONS.length) {
      const sql = MIGRATIONS[version] as string
      this.db.transaction(() => {
        this.db.exec(sql)
        this.db.prepare('UPDATE schema_version SET version = ?').run(version + 1)
      })()
      version++
    }
  }

  append(e: AnyEvent): void {
    this.insertEvent.run({
      seq: e.seq,
      type: e.type,
      actor: e.actor,
      visibility: JSON.stringify(e.visibility),
      payload: JSON.stringify(e.payload),
      simTime: e.simTime,
      wallMs: Math.round(e.wallMs),
      idempotencyKey: e.idempotencyKey,
      schemaVersion: e.schemaVersion,
    })
  }

  /** 저장된 이벤트를 검증하며 읽는다. 스키마가 맞지 않으면 예외를 던진다. */
  loadEvents(): AnyEvent[] {
    const rows = this.db.prepare('SELECT * FROM events ORDER BY seq').all() as Record<string, unknown>[]
    return rows.map((r) => {
      const type = String(r.type)
      if (!isEventType(type)) throw new Error(`unknown event type in store: ${type}`)
      if (Number(r.schema_version) > EVENT_SCHEMA_VERSION) throw new Error('event schema is newer than this build')
      return {
        runId: this.runId,
        seq: Number(r.seq),
        type,
        actor: String(r.actor),
        visibility: visibilitySchema.parse(JSON.parse(String(r.visibility))),
        payload: parseEventPayload(type, JSON.parse(String(r.payload))),
        simTime: String(r.sim_time),
        wallMs: Number(r.wall_ms),
        idempotencyKey: r.idempotency_key === null ? null : String(r.idempotency_key),
        schemaVersion: Number(r.schema_version),
      } as AnyEvent
    })
  }

  recordDelivery(d: DeliveryRow): void {
    this.insertDelivery.run({ ...d, eventSeqs: JSON.stringify(d.eventSeqs), memoryIds: JSON.stringify(d.memoryIds) })
  }

  loadDeliveries(): DeliveryRow[] {
    const rows = this.db.prepare('SELECT * FROM deliveries').all() as Record<string, unknown>[]
    return rows.map((r) => ({
      callId: String(r.call_id),
      ownerId: r.owner_id === null ? null : String(r.owner_id),
      task: String(r.task),
      attempt: Number(r.attempt),
      seqAtCall: Number(r.seq_at_call),
      eventSeqs: JSON.parse(String(r.event_seqs)) as number[],
      memoryIds: JSON.parse(String(r.memory_ids)) as string[],
      promptText: String(r.prompt_text),
    }))
  }

  recordCall(c: CallRow): void {
    this.insertCall.run({ ...c, durationMs: Math.round(c.durationMs), issues: JSON.stringify(c.issues) })
  }

  callStats(): { task: string; outcome: string; count: number; avgMs: number }[] {
    return this.db
      .prepare('SELECT task, outcome, COUNT(*) AS count, AVG(duration_ms) AS avgMs FROM llm_calls GROUP BY task, outcome ORDER BY task')
      .all() as { task: string; outcome: string; count: number; avgMs: number }[]
  }

  close(): void {
    this.db.close()
  }
}
