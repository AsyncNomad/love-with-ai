import type { AnyEvent, GameConfig, ParticipantId, RoomId, SpeechLevel } from '@heart/shared'
import {
  canObserve,
  currentMembers,
  getRelationship,
  knownNameIds,
  knownProfile,
  pairKey,
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

  speechLevel(targetId: ParticipantId): SpeechLevel {
    return this.state.speechLevels.get(pairKey(this.ownerId, targetId)) ?? 'polite'
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
