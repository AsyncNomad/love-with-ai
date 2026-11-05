import type { AnyEvent, GameConfig, ParticipantId, RoomId, SpeechLevel, StageId } from '@heart/shared'
import { STAGE_META } from '@heart/shared'
import {
  canObserve,
  currentMembers,
  getRelationship,
  knownNameIds,
  knownProfile,
  speechLevelOf,
  type KnownProfile,
  type MemoryRecord,
  type ParticipantRecord,
  type RelationshipState,
  type RunState,
} from '@heart/engine'

export interface ObservedMessage {
  seq: number
  speakerId: string
  speakerLabel: string
  isSelf: boolean
  text: string
}

/**
 * 한 참가자의 시점(design.md §6.2). agents 패키지가 게임 상태를 읽는 유일한 통로다.
 * 돌려준 데이터의 근거 이벤트 seq를 `touched`에 모아 두고, 호출마다 deliveries에 기록한다.
 */
export class ObservationView {
  readonly touched = new Set<number>()
  readonly memoryIds = new Set<string>()
  private observedCache: AnyEvent[] | null = null
  private knownNamesCache: Set<ParticipantId> | null = null

  constructor(
    private readonly state: RunState,
    readonly ownerId: ParticipantId,
    private readonly config: GameConfig,
  ) {}

  get seqAtCall(): number {
    return this.state.lastSeq
  }

  get simTime(): string {
    return this.state.simTime
  }

  self(): ParticipantRecord {
    const rec = this.state.participants.get(this.ownerId)
    if (!rec) throw new Error(`unknown participant ${this.ownerId}`)
    this.touched.add(rec.castSeq)
    if (rec.flavorSeq !== null) this.touched.add(rec.flavorSeq)
    return rec
  }

  /** 이 참가자가 관찰한 이벤트. 근거로 쓰는 쪽에서 touch한다. */
  private observed(): AnyEvent[] {
    this.observedCache ??= this.state.events.filter((e) => canObserve(this.state, this.ownerId, e))
    return this.observedCache
  }

  knownNames(): Set<ParticipantId> {
    this.knownNamesCache ??= knownNameIds(this.state, this.ownerId)
    return this.knownNamesCache
  }

  known(subjectId: ParticipantId): KnownProfile {
    const k = knownProfile(this.state, this.ownerId, subjectId)
    for (const s of k.sourceSeqs) this.touched.add(s)
    return k
  }

  label(subjectId: ParticipantId): string {
    if (subjectId === this.ownerId) return this.state.participants.get(subjectId)?.cast.name ?? '나'
    return this.known(subjectId).name ?? '처음 보는 참가자'
  }

  /** 같은 방에 지금 있는 다른 참가자. 눈앞에 있는 사람은 이름을 몰라도 존재는 안다. */
  presentOthers(roomId: RoomId): ParticipantId[] {
    const room = this.state.rooms.get(roomId)
    if (!room) return []
    return currentMembers(room).filter((id) => id !== this.ownerId)
  }

  roomLocation(roomId: RoomId): string {
    return this.state.rooms.get(roomId)?.location ?? '알 수 없는 곳'
  }

  /**
   * 이 방에서 관찰한 최근 대화. 그 방에 낸 PD 안내(브런치·활동의 상황 카드 등)도 순서대로 끼운다.
   * 상황 카드가 대화의 맥락이 되기 때문이다.
   */
  roomMessages(roomId: RoomId, maxCount: number, charBudget: number): ObservedMessage[] {
    const all = this.observed().filter((e) => (e.type === 'MESSAGE_SENT' || e.type === 'PD_ANNOUNCED') && e.payload.roomId === roomId)
    const out: ObservedMessage[] = []
    let used = 0
    for (let i = all.length - 1; i >= 0 && out.length < maxCount; i--) {
      const e = all[i] as AnyEvent & { type: 'MESSAGE_SENT' | 'PD_ANNOUNCED' }
      const text = e.payload.text
      if (used + text.length > charBudget && out.length > 0) break
      used += text.length
      this.touched.add(e.seq)
      const pd = e.type === 'PD_ANNOUNCED'
      out.unshift({ seq: e.seq, speakerId: pd ? 'pd' : e.actor, speakerLabel: pd ? 'PD 안내' : this.label(e.actor), isSelf: !pd && e.actor === this.ownerId, text })
    }
    return out
  }

  /**
   * 함께 겪은 일(사실). 이 참가자가 들어갔던 거실 밖의 방(1:1, 그룹 대화, 브런치, 활동, 데이트)을 시간 순으로 돌려준다.
   * LLM이 만든 기억이 아니라 방 멤버십에서 서버가 만든다(D7). 실측에서 "첫날 아침 제 요리를 다 드셨던 기억"처럼
   * 없는 추억을 지어내는 일이 잦아서, 실제로 함께 한 일을 명시해 그 밖의 것은 없다고 알려 준다(design.md D37).
   * 예산을 넘으면 오래된 것부터 뺀다. 근거는 본인의 입장(MEMBER_JOINED) 이벤트다.
   */
  sharedHistory(charBudget: number): { seq: number; line: string }[] {
    const stages = this.state.events.filter((e): e is AnyEvent & { type: 'STAGE_STARTED' } => e.type === 'STAGE_STARTED')
    const items: { seq: number; line: string }[] = []
    for (const room of this.state.rooms.values()) {
      if (room.kind === 'living') continue
      const mine = room.memberships.find((m) => m.participantId === this.ownerId)
      if (!mine) continue
      // 지금 있는 방은 지난 일이 아니다. 섞이면 "지금 이 자리"를 과거의 추억처럼 말한다(실측).
      if (room.closedSeq === null && mine.leftSeq === null) continue
      const stage = stages.filter((s) => s.seq < room.openedSeq).at(-1)
      const when = stage ? relativeStageLabel(stage.payload.stage, this.state.stage) : ''
      const others = [...new Set(room.memberships.map((m) => m.participantId))].filter((id) => id !== this.ownerId)
      const names = others.map((id) => this.label(id)).join(', ')
      const who = `${names}${withParticle(names)} ${others.length === 1 ? '단둘이' : '함께'}`
      items.push({ seq: mine.joinedSeq, line: `${when} · ${room.location} · ${who}` })
    }
    items.sort((a, b) => a.seq - b.seq)
    const out: { seq: number; line: string }[] = []
    let used = 0
    for (let i = items.length - 1; i >= 0; i--) {
      const item = items[i] as { seq: number; line: string }
      if (used + item.line.length > charBudget) break
      used += item.line.length
      this.touched.add(item.seq)
      out.unshift(item)
    }
    return out
  }

  /** 이 참가자가 하우스에 들어온 뒤의 일정(공개 정보). "어제 밤"이 무엇이었는지 같은 시간 감각의 근거다. */
  scheduleSoFar(): string {
    const entered = this.state.participants.get(this.ownerId)?.enteredSeq ?? Number.POSITIVE_INFINITY
    const byDay = new Map<number, string[]>()
    for (const e of this.state.events) {
      if (e.type !== 'STAGE_STARTED' || e.payload.stage === 'CASTING') continue
      const meta = STAGE_META[e.payload.stage]
      if (e.seq < entered && meta.day >= 1) {
        // 들어오기 전의 일정은 이름만 안다(메기). 하루 단위로만 남긴다.
        if (!byDay.has(meta.day)) byDay.set(meta.day, ['(입주 전)'])
        continue
      }
      const list = byDay.get(meta.day) ?? []
      if (list[0] === '(입주 전)') list.length = 0
      if (list.at(-1) !== meta.label) list.push(meta.label)
      byDay.set(meta.day, list)
    }
    const today = this.state.stage ? STAGE_META[this.state.stage].day : 0
    const rel = (day: number): string => (day === today ? '(오늘)' : day === today - 1 ? '(어제)' : '')
    return [...byDay].map(([day, labels]) => `${day}일차${rel(day)}: ${labels.join(' · ')}`).join('\n')
  }

  /**
   * 최근 관찰한 대화(어느 방이든)에서 자주 나온 화제 낱말. 대화가 같은 취미 이야기로 맴도는 것을 막는 데 쓴다(실측: 러닝·와인).
   * 사실 판단이 아니라 화제 조절용이라 근거 seq로 남기지 않는다.
   */
  wornTopics(keywords: readonly string[], window = 40, min = 3): string[] {
    const recent = this.observed()
      .filter((e): e is AnyEvent & { type: 'MESSAGE_SENT' } => e.type === 'MESSAGE_SENT')
      .slice(-window)
      .map((e) => e.payload.text)
    return keywords
      .map((k) => ({ k, n: recent.filter((t) => t.includes(k)).length }))
      .filter((x) => x.n >= min)
      .sort((a, b) => b.n - a.n)
      .slice(0, 3)
      .map((x) => x.k)
  }

  /**
   * 본인만 아는 일: 받은 익명 카드, 내가 보낸 카드, 우체통 질문과 답(game-rules.md §5.5, §6.1).
   * 보낸 사람을 모르는 카드는 보낸 사람을 쓰지 않는다. 이벤트에도 그 값이 없다.
   */
  privateSignals(charBudget: number): { seq: number; line: string }[] {
    const lines: { seq: number; line: string }[] = []
    let used = 0
    for (const e of this.observed()) {
      const line = this.signalLine(e)
      if (line === null || used + line.length > charBudget) continue
      used += line.length
      this.touched.add(e.seq)
      lines.push({ seq: e.seq, line })
    }
    return lines
  }

  private signalLine(e: AnyEvent): string | null {
    switch (e.type) {
      case 'SIGNAL_CARD_RECEIVED':
        return e.payload.recipientId === this.ownerId ? `[받은 카드] 보낸 사람을 모르는 카드가 나에게 왔다: "${e.payload.text}"` : null
      case 'SIGNAL_CARD_SENT':
        if (e.payload.senderId !== this.ownerId) return null
        return e.payload.targetId ? `[보낸 카드] 내가 ${this.label(e.payload.targetId)}에게 보냈다(상대는 내가 보낸 줄 모른다): "${e.payload.text}"` : '[보낸 카드] 아무에게도 보내지 않았다.'
      case 'MAILBOX_QUESTION':
        return e.payload.askerId === this.ownerId
          ? `[우체통] 내가 ${this.label(e.payload.targetId)}에게 물었다: "${e.payload.text}"`
          : `[우체통] ${this.label(e.payload.askerId)}이(가) 나에게 물었다: "${e.payload.text}"`
      case 'MAILBOX_ANSWER':
        return e.payload.answererId === this.ownerId ? `[우체통] 내가 받은 질문에 답했다: "${e.payload.text}"` : `[우체통] ${this.label(e.payload.answererId)}이(가) 내 질문에 답했다: "${e.payload.text}"`
      default:
        return null
    }
  }

  /** 기억 요약·관계 평가용: sinceSeq 이후에 관찰한 대화·공지·카드·우체통. */
  observedSince(sinceSeq: number, charBudget: number): { seq: number; line: string }[] {
    const lines: { seq: number; line: string }[] = []
    let used = 0
    for (const e of this.observed()) {
      if (e.seq <= sinceSeq) continue
      const line =
        e.type === 'MESSAGE_SENT'
          ? `[${this.roomLocation(e.payload.roomId)}] ${this.label(e.actor)}: ${e.payload.text}`
          : e.type === 'PD_ANNOUNCED'
            ? `[PD 안내] ${e.payload.text}`
            : this.signalLine(e)
      if (line === null) continue
      if (used + line.length > charBudget) break
      used += line.length
      this.touched.add(e.seq)
      lines.push({ seq: e.seq, line })
    }
    return lines
  }

  memories(aboutIds: readonly ParticipantId[], charBudget: number): MemoryRecord[] {
    const mine = this.state.memories.filter((m) => m.ownerId === this.ownerId)
    const relevant = mine.filter((m) => m.aboutIds.length === 0 || m.aboutIds.some((id) => aboutIds.includes(id)))
    const out: MemoryRecord[] = []
    let used = 0
    for (let i = relevant.length - 1; i >= 0; i--) {
      const m = relevant[i] as MemoryRecord
      if (used + m.content.length > charBudget) continue
      used += m.content.length
      this.touched.add(m.seq)
      this.memoryIds.add(m.memoryId)
      out.unshift(m)
    }
    return out
  }

  relationship(targetId: ParticipantId): RelationshipState {
    const r = getRelationship(this.state, this.ownerId, targetId, this.config.relationship.initial)
    for (const s of r.updateSeqs) this.touched.add(s)
    return r
  }

  /** 내가 이 사람에게 쓰는 말투(방향 있음, D38). */
  speechLevel(targetId: ParticipantId): SpeechLevel {
    return speechLevelOf(this.state, this.ownerId, targetId)
  }

  /** 이 사람이 나에게 쓰는 말투. */
  speechLevelFrom(targetId: ParticipantId): SpeechLevel {
    return speechLevelOf(this.state, targetId, this.ownerId)
  }

  /** 본인이 이전 투표에서 고른 대상(본인만 안다). */
  ownBallots(): { kind: string; targetId: ParticipantId | null; seq: number }[] {
    const out: { kind: string; targetId: ParticipantId | null; seq: number }[] = []
    for (const vote of this.state.votes.values()) {
      const b = vote.ballots.get(this.ownerId)
      if (!b) continue
      this.touched.add(b.seq)
      out.push({ kind: vote.kind, targetId: b.targetId, seq: b.seq })
    }
    return out
  }

  /** 이 참가자가 아직 이름을 모르는 참가자들의 이름(canary). */
  unknownNames(): string[] {
    const known = this.knownNames()
    return [...this.state.participants.values()].filter((p) => !known.has(p.cast.id)).map((p) => p.cast.name)
  }

  /** 본인 최근 발언(반복 검사용). */
  ownRecentMessages(limit: number): string[] {
    const mine = this.observed().filter((e) => e.type === 'MESSAGE_SENT' && e.actor === this.ownerId)
    return mine.slice(-limit).map((e) => (e as AnyEvent & { type: 'MESSAGE_SENT' }).payload.text)
  }
}

/** 받침에 맞는 '와/과'. 한글이 아니면 둘 다 적는다. */
function withParticle(word: string): string {
  const code = word.charCodeAt(word.length - 1) - 0xac00
  if (code < 0 || code > 11171) return '와(과)'
  return code % 28 === 0 ? '와' : '과'
}

/**
 * "오늘 첫인상 대화", "어제 심야 대화"처럼 지금 기준의 상대 날짜를 붙인다.
 * 실측: 1일차 밤에 같은 날 오후의 대화를 "어제"라고 말했다. "1일차"만 주면 오늘인지 어제인지 헷갈린다.
 */
function relativeStageLabel(stage: StageId, current: StageId | null): string {
  const meta = STAGE_META[stage]
  const today = current ? STAGE_META[current].day : meta.day
  const diff = today - meta.day
  const day = diff === 0 ? '오늘' : diff === 1 ? '어제' : diff === 2 ? '그저께' : `${meta.day}일차`
  return `${day} ${meta.label}`
}
