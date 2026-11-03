import type { ParticipantId, StageId, VoteKind } from '@heart/shared'
import { ballotsOf, inviteCandidates, oppositeGenderRule, type TalkRequest } from '@heart/engine'
import { SITUATION_CARD, type ChatScene } from '../chat-scene'
import type { StageContext } from '../director'
import { LIVING_ROOM } from '../house'
import { PD, formatMinutes } from '../pd'

/** 단계 핸들러들이 함께 쓰는 진행 절차. */

export function enteredAiIds(ctx: StageContext): ParticipantId[] {
  return [...ctx.session.state.participants.values()]
    .filter((p) => !p.cast.isHuman && p.enteredSeq !== null)
    .sort((a, b) => a.cast.entryOrder - b.cast.entryOrder)
    .map((p) => p.cast.id)
}

export function startLiving(ctx: StageContext): void {
  ctx.shared.living?.stop()
  ctx.shared.living = ctx.scene({ roomId: LIVING_ROOM, mode: 'live' }).start()
}

export function stopLiving(ctx: StageContext): void {
  ctx.shared.living?.stop()
  ctx.shared.living = null
}

/** 거실 대화가 끝난 뒤, 각 AI가 그동안 말을 많이 나눈 사람(최대 3명)에 대한 인상을 갱신한다. */
export function reflectOnLiving(ctx: StageContext, sinceSeq: number, label: string): void {
  const state = ctx.session.state
  const counts = new Map<ParticipantId, number>()
  for (const e of state.events) {
    if (e.seq <= sinceSeq || e.type !== 'MESSAGE_SENT' || e.payload.roomId !== LIVING_ROOM) continue
    counts.set(e.actor, (counts.get(e.actor) ?? 0) + 1)
  }
  for (const owner of ctx.house.members(LIVING_ROOM)) {
    if (owner === state.humanId) continue
    const targets = [...counts.entries()]
      .filter(([id]) => id !== owner)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([id]) => id)
    ctx.agents.reflectLater(owner, targets, sinceSeq, label)
  }
}

export interface VoteOptions {
  /** 제한 시간(timeScale 적용 전). null이면 사람이 제출할 때까지 기다린다(최종 선택, game-rules.md §6.4). */
  timeoutMs?: number | null
}

/**
 * 비공개 투표 하나(game-rules.md §7). AI는 P2로 동시에 큐에 넣고, 사람에게는 선택 창을 띄운다.
 * 사람이 시간 안에 고르지 않으면 유보로 확정한다. 최종 선택은 시간 제한 없이 기다린다.
 */
export async function runVote(ctx: StageContext, stage: StageId, kind: VoteKind, title: string, description: string, opts: VoteOptions = {}): Promise<string> {
  const { session } = ctx
  const voteId = `vote_${stage}`
  session.commit({ type: 'VOTE_OPENED', payload: { voteId, kind }, visibility: { kind: 'house' }, idempotencyKey: voteId })
  ctx.shared.votes[stage] = voteId
  const human = ctx.human.humanId
  const aiDone = Promise.all(enteredAiIds(ctx).map((id) => ctx.agents.vote(voteId, id, kind, oppositeGenderRule(session.state, id))))
  let humanAnswered = false
  const humanDone = ctx.human
    .requestVote(voteId, { title, description, candidateIds: oppositeGenderRule(session.state, human), allowAbstain: true, confirmTwice: kind === 'final' })
    .then((target) => {
      humanAnswered = true
      session.commit({
        type: 'VOTE_COMMITTED',
        actor: human,
        payload: { voteId, voterId: human, targetId: target ?? null, reason: null, auto: target === undefined },
        visibility: { kind: 'participants', ids: [human] },
        idempotencyKey: `vote:${voteId}:${human}`,
      })
    })
  const timeoutMs = opts.timeoutMs === undefined ? ctx.config.timing.voteMs : opts.timeoutMs
  const timer = timeoutMs === null ? null : ctx.countdown(title, ctx.scaled(timeoutMs))
  await Promise.race([...(timer ? [timer.promise] : []), Promise.all([aiDone, humanDone])])
  if (!humanAnswered) ctx.human.expire(`vote:${voteId}`)
  await humanDone
  await aiDone
  timer?.cancel()
  session.commit({ type: 'VOTE_CLOSED', payload: { voteId }, visibility: { kind: 'house' } })
  ctx.house.announce('vote_closed', PD.voteClosed())
  return voteId
}

/** 첫인상 초대 수락 판단(game-rules.md §8.2-2). 결과는 대상 본인만 안다. */
export async function collectInvites(ctx: StageContext, voteId: string): Promise<Map<ParticipantId, ParticipantId[]>> {
  const { session } = ctx
  const human = ctx.human.humanId
  const candidates = inviteCandidates(ballotsOf(session.state, voteId))
  const accepted = new Map<ParticipantId, ParticipantId[]>()
  if (candidates.size === 0) return accepted
  const commit = (target: ParticipantId, cands: ParticipantId[], ids: ParticipantId[]): void => {
    accepted.set(target, ids)
    session.commit({
      type: 'INVITE_DECIDED',
      actor: target,
      payload: { voteId, targetId: target, candidateIds: cands, acceptedIds: ids },
      visibility: { kind: 'participants', ids: [target] },
    })
  }
  let humanAnswered = !candidates.has(human)
  const jobs = [...candidates.entries()].map(async ([target, voters]) => {
    if (target === human) {
      const ids = await ctx.human.requestInvite(voteId, voters, ctx.config.assignment.inviteMaxAccept)
      humanAnswered = true
      commit(target, voters, ids ?? [])
    } else {
      commit(target, voters, await ctx.agents.inviteDecision(voteId, target, voters))
    }
  })
  const all = Promise.all(jobs)
  const timer = ctx.countdown('대화 초대', ctx.scaled(ctx.config.timing.inviteMs))
  await Promise.race([timer.promise, all])
  if (!humanAnswered) ctx.human.expire(`invite:${voteId}`)
  await all
  timer.cancel()
  return accepted
}

interface TalkRoom {
  roomId: string
  members: ParticipantId[]
  openSeq: number
  scene: ChatScene
  cards: string[]
}

/** 사람이 있는 방에 남은 상황 카드를 대화 시간 동안 고르게 나눠 낸다. */
function scheduleCards(ctx: StageContext, room: TalkRoom, durationMs: number): { cancel(): void }[] {
  const rest = room.cards.slice(1)
  return rest.map((text, i) => {
    // Countdown.cancel()은 promise를 resolve하므로 취소 여부를 따로 기억한다.
    let cancelled = false
    const wait = ctx.clock.wait(Math.round((durationMs * (i + 1)) / (rest.length + 1)))
    void wait.promise.then(() => {
      if (!cancelled && ctx.house.isOpen(room.roomId)) ctx.house.announce(SITUATION_CARD, text, { roomId: room.roomId })
    })
    return {
      cancel: () => {
        cancelled = true
        wait.cancel()
      },
    }
  })
}

export interface SlotOptions {
  durationMs: number
  label: string
  /** 사람이 이번 슬롯에 방이 없을 때 보낼 개인 안내 */
  idleNotice: string | null
  /** 방 장소. 없으면 하우스의 비공개 장소를 돌아가며 쓴다. */
  locationOf?: (req: TalkRequest, index: number) => string
  /**
   * PD 상황 카드(브런치·활동, game-rules.md §5.2). 첫 카드는 방이 열릴 때 내고, 사람이 있는 방에는
   * 나머지를 대화 시간 동안 고르게 나눠 낸다. 백그라운드 방은 첫 카드만 받는다(발언 수가 정해진 짧은 장면이라서).
   */
  cardsOf?: (req: TalkRequest, index: number) => string[]
  /** 백그라운드 장면 발언 수. 없으면 config.assignment.backgroundUtterances */
  utterances?: { min: number; max: number }
}

/**
 * 대화 슬롯 하나를 실행한다(game-rules.md §8). 사람이 있는 방은 실시간으로, 나머지는 백그라운드 장면으로 돈다.
 * 사람의 1:1 타이머는 AI 응답을 기다리는 동안 멈춘다(design.md §12).
 */
export async function runTalkSlot(ctx: StageContext, slot: readonly TalkRequest[], opts: SlotOptions): Promise<void> {
  const { house, session, config } = ctx
  const human = ctx.human.humanId
  const rng = ctx.rng
  const rooms: TalkRoom[] = []
  slot.forEach((req, index) => {
    const roomId = house.openRoom(req.members.length === 2 ? 'private' : 'group', opts.locationOf?.(req, index))
    const openSeq = session.state.lastSeq
    for (const m of req.members) house.moveTo(roomId, m)
    house.announce('talk_start', PD.talkStart(formatMinutes(opts.durationMs)), { roomId })
    const cards = opts.cardsOf?.(req, index) ?? []
    if (cards[0]) house.announce(SITUATION_CARD, cards[0], { roomId })
    rooms.push({ roomId, members: req.members, openSeq, scene: null as unknown as ChatScene, cards })
  })
  const humanRoom = rooms.find((r) => r.members.includes(human)) ?? null
  const { min, max } = opts.utterances ?? config.assignment.backgroundUtterances
  for (const r of rooms) {
    const ais = r.members.filter((m) => m !== human)
    // 상황 카드가 있으면 첫 발언은 카드에 대한 반응이다. 그 밖에는 둘이면 말 걸기, 셋 이상이면 화제 꺼내기.
    const openerMode = r.cards.length > 0 ? 'reply' : r.members.length === 2 ? 'open_private' : 'start_topic'
    r.scene = ctx
      .scene({
        roomId: r.roomId,
        mode: r === humanRoom ? 'live' : 'background',
        targetUtterances: rng.int(min, max),
        opener: { speakerId: rng.pick(ais), mode: openerMode },
      })
      .start()
  }
  const cardTimers = humanRoom ? scheduleCards(ctx, humanRoom, opts.durationMs) : []

  let livingScene: ChatScene | null = null
  if (!humanRoom) {
    if (opts.idleNotice) house.announce('idle_slot', opts.idleNotice, { to: [human] })
    const livingAis = house.members(LIVING_ROOM).filter((id) => id !== human)
    if (livingAis.length > 0) livingScene = ctx.scene({ roomId: LIVING_ROOM, mode: 'live' }).start()
  }

  if (humanRoom) await runHumanRoom(ctx, humanRoom, opts)
  for (const t of cardTimers) t.cancel()

  const background = rooms.filter((r) => r !== humanRoom)
  if (background.length > 0) {
    {
      const timeout = ctx.clock.wait(config.timing.backgroundSceneTimeoutMs)
      const allDone = Promise.all(background.map((r) => r.scene.done))
      let waiting = false
      const notice = ctx.clock.wait(1_500)
      void notice.promise.then(() => {
        if (!waiting) return
        house.announce('waiting_others', PD.waitingOthers(), { to: [human] })
      })
      waiting = true
      await Promise.race([allDone, timeout.promise])
      waiting = false
      notice.cancel()
      timeout.cancel()
    }
    for (const r of background) {
      r.scene.stop()
      closeTalkRoom(ctx, r)
    }
  }
  livingScene?.stop()

  for (const r of rooms) {
    for (const m of r.members) {
      if (m === human) continue
      ctx.agents.reflectLater(m, r.members.filter((x) => x !== m), r.openSeq, opts.label)
    }
  }
}

async function runHumanRoom(ctx: StageContext, room: TalkRoom, opts: SlotOptions): Promise<void> {
  const { config, house, session } = ctx
  const human = ctx.human.humanId
  const skip = ctx.human.skipSignal(room.roomId)
  const hold = (): boolean => room.scene.humanWaitHeld()
  const warning = Math.min(config.timing.endWarningMs, opts.durationMs / 2)
  const main = ctx.countdown(opts.label, opts.durationMs - warning, hold)
  let skipped = await Promise.race([main.promise.then(() => false), skip.promise.then(() => true)])
  main.cancel()
  if (!skipped) {
    house.announce('talk_warning', PD.talkWarning(), { roomId: room.roomId })
    room.scene.setWrapUp()
    const tail = ctx.countdown(opts.label, warning, hold)
    skipped = await Promise.race([tail.promise.then(() => false), skip.promise.then(() => true)])
    tail.cancel()
  }
  skip.dispose()
  if (skipped) {
    session.commit({ type: 'TALK_SKIPPED', actor: human, payload: { roomId: room.roomId, participantId: human }, visibility: { kind: 'room' } })
    room.scene.stop()
  } else {
    await room.scene.finish(config.timing.endGraceMs)
  }
  closeTalkRoom(ctx, room, skipped)
}

function closeTalkRoom(ctx: StageContext, room: TalkRoom, skipped = false): void {
  const { house } = ctx
  if (!house.isOpen(room.roomId)) return
  house.announce(skipped ? 'talk_skipped' : 'talk_end', skipped ? PD.talkSkipped() : PD.talkEnd(), { roomId: room.roomId })
  house.closeRoom(room.roomId)
  for (const m of room.members) house.join(LIVING_ROOM, m)
}
