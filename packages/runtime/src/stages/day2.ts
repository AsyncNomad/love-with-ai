import type { ParticipantId } from '@heart/shared'
import { activityGroups, brunchGroups, oppositeGenderRule, pairKey, type ActivityPick, type Rng } from '@heart/engine'
import type { StageContext, StageHandler } from '../director'
import { Priority } from '../gpu-queue'
import { LIVING_ROOM } from '../house'
import { PD } from '../pd'
import { enteredAiIds, reflectOnLiving, runTalkSlot, startLiving, stopLiving } from './common'
import { livingStage, nightTalksStage, nightVoteStage, wrapStage } from './routines'

/** game-rules.md §5: 2일차 단계 핸들러. */

const morning = livingStage('D2_MORNING', { timerLabel: '아침 대화', ms: (t) => t.morningTalkMs, announce: PD.morning, reflect: '둘째 날 아침 대화', startsDay: true })

/** 첫 카드(미션 시작)는 항상 내고, 나머지는 시드로 고르되 원래 순서를 지킨다. */
function pickCards(cards: readonly string[], n: number, rng: Rng): string[] {
  const [head, ...rest] = cards
  if (head === undefined) return []
  const chosen = new Set(rng.shuffle(rest).slice(0, Math.max(0, n - 1)))
  return [head, ...rest.filter((c) => chosen.has(c))]
}

function participantsInHouse(ctx: StageContext): ParticipantId[] {
  return [ctx.human.humanId, ...enteredAiIds(ctx)]
}

const brunch: StageHandler = {
  id: 'D2_BRUNCH',
  async run(ctx) {
    stopLiving(ctx)
    const { session, config } = ctx
    const ev = config.events
    const ids = participantsInHouse(ctx)
    // 1일차 심야에 1:1을 한 쌍은 같은 조에 넣지 않는다(§5.2).
    const avoid = new Set(
      (ctx.shared.plans.D1_NIGHT_TALKS?.slots.flat() ?? []).filter((r) => r.members.length === 2).map((r) => pairKey(r.members[0] as string, r.members[1] as string)),
    )
    const members = ids.map((id) => ({ id, gender: session.state.participants.get(id)?.cast.gender ?? 'male' }))
    const groups = brunchGroups(members, avoid, ctx.rng, config.assignment.brunchGroupSize.max)
    const slot = groups.map((g) => ({ members: g, required: false }))
    session.commit({ type: 'TALKS_PLANNED', payload: { stage: 'D2_BRUNCH', slots: [slot], dropped: [] }, visibility: { kind: 'server' } })
    ctx.house.announce('brunch', PD.brunch())
    await runTalkSlot(ctx, slot, {
      durationMs: ctx.scaled(config.timing.brunchMs),
      label: '브런치 미션',
      idleNotice: null,
      locationOf: (_r, i) => ev.brunchLocations[i % ev.brunchLocations.length] ?? '주방',
      cardsOf: () => pickCards(ev.brunchCards, ev.brunchCardsPerRoom, ctx.rng),
      utterances: config.assignment.groupBackgroundUtterances,
    })
  },
}

/**
 * 메기 입장(§5.3). 입장 처리는 1일차와 같고, 메기는 나이·직업도 입장할 때 공개한다.
 * 기존 관계를 요약해 주지 않는다: 메기는 입장 이후에 관찰한 것만 안다(가시성 규칙이 보장한다).
 */
function catfishStage(id: 'D2_CATFISH_1' | 'D2_CATFISH_2', index: number): StageHandler {
  return {
    id,
    async run(ctx) {
      const { house, session, config } = ctx
      ctx.shared.catfishOrder ??= ctx.rng.shuffle(
        [...session.state.participants.values()]
          .filter((p) => p.cast.isCatfish)
          .sort((a, b) => a.cast.entryOrder - b.cast.entryOrder)
          .map((p) => p.cast.id),
      )
      const cid = ctx.shared.catfishOrder[index]
      const cast = cid ? session.state.participants.get(cid)?.cast : undefined
      if (!cid || !cast) return
      const since = session.state.lastSeq
      if (!ctx.shared.living) startLiving(ctx)
      house.announce('catfish_arrival', PD.catfishArrival())
      house.enterHouse(cid)
      house.join(LIVING_ROOM, cid)
      house.disclose(cid, { age: cast.age, occupation: cast.occupation })
      house.announce('catfish_profile', PD.catfishProfile(cast.name, cast.age, cast.occupation))
      const greeting = await ctx.agents.speak({ speakerId: cid, roomId: LIVING_ROOM, mode: 'newcomer_greeting', isPrivate: false }, Priority.P1_SCENE)
      if (greeting) {
        ctx.shared.living?.primeReactions(2)
        house.say(LIVING_ROOM, cid, greeting, false)
      }
      await ctx.countdown('새 입주자', ctx.scaled(config.timing.catfishGreetMs)).promise
      stopLiving(ctx)
      reflectOnLiving(ctx, since, '새 입주자 등장')
    },
  }
}

const freeTalk = livingStage('D2_FREE_TALK', { timerLabel: '자유 대화', ms: (t) => t.d2FreeTalkMs, announce: PD.freeTalkShort, reflect: '둘째 날 낮 대화' })

const activityChoice: StageHandler = {
  id: 'D2_ACTIVITY_CHOICE',
  async run(ctx) {
    stopLiving(ctx)
    const { session, config } = ctx
    const human = ctx.human.humanId
    const options = config.events.activities.map((a) => ({ id: a.id, name: a.name, description: a.description }))
    ctx.house.announce('activity_choice', PD.activityChoice())
    const picks = new Map<ParticipantId, ActivityPick>()
    // 고르지 않았거나(사람이 시간 초과) 생성에 실패하면 무작위 지망을 쓴다. 모두 어떤 활동에든 참여한다(§5.4).
    const fallback = (): ActivityPick => {
      const [a, b] = ctx.rng.shuffle(options)
      return { first: a?.id ?? '', second: b?.id ?? '' }
    }
    const commit = (id: ParticipantId, pick: ActivityPick | null | undefined): void => {
      const final = pick ?? fallback()
      picks.set(id, final)
      session.commit({ type: 'ACTIVITY_CHOSEN', actor: id, payload: { participantId: id, ...final, auto: !pick }, visibility: { kind: 'participants', ids: [id] } })
    }
    const humanDone = ctx.human.requestActivity(options).then((a) => commit(human, a))
    const aiDone = Promise.all(enteredAiIds(ctx).map(async (id) => commit(id, await ctx.agents.activityChoice(id, options))))
    const timer = ctx.countdown('활동 선택', ctx.scaled(config.timing.activityChoiceMs))
    await Promise.race([timer.promise, Promise.all([humanDone, aiDone])])
    ctx.human.expire('activity')
    await humanDone
    await aiDone
    timer.cancel()
    const groups = activityGroups(participantsInHouse(ctx), picks, config.assignment.activityGroupMax)
    ctx.shared.activityGroups = groups
    session.commit({
      type: 'TALKS_PLANNED',
      payload: { stage: 'D2_ACTIVITY_TALKS', slots: [groups.map((g) => ({ members: g.members, required: false }))], dropped: [] },
      visibility: { kind: 'server' },
    })
    ctx.house.announce('activity_groups', PD.activityGroups())
  },
}

const activityTalks: StageHandler = {
  id: 'D2_ACTIVITY_TALKS',
  async run(ctx) {
    const { config } = ctx
    const groups = ctx.shared.activityGroups ?? []
    const byId = new Map(config.events.activities.map((a) => [a.id, a]))
    const activityAt = (i: number) => byId.get(groups[i]?.activityId ?? '')
    await runTalkSlot(
      ctx,
      groups.map((g) => ({ members: g.members, required: false })),
      {
        durationMs: ctx.scaled(config.timing.activityTalkMs),
        label: '활동',
        idleNotice: null,
        locationOf: (_r, i) => activityAt(i)?.location ?? '숙소',
        cardsOf: (_r, i) => activityAt(i)?.cards ?? [],
        utterances: config.assignment.groupBackgroundUtterances,
      },
    )
  },
}

const regroup = livingStage('D2_REGROUP', { timerLabel: '거실 대화', ms: (t) => t.d2RegroupMs, announce: PD.d2Regroup, reflect: '활동 뒤 거실 대화' })

/**
 * 익명 시그널 카드(§5.5). 모두 작성한 뒤 한꺼번에, 섞은 순서로 전달한다.
 * 전달 이벤트에는 보낸 사람을 가리키는 값이 없고, 순서·시각으로도 보낸 사람을 짐작할 수 없게 한다.
 */
const signalCard: StageHandler = {
  id: 'D2_SIGNAL_CARD',
  async run(ctx) {
    stopLiving(ctx)
    const { session, config } = ctx
    const human = ctx.human.humanId
    ctx.house.announce('signal_card', PD.signalCard())
    await ctx.agents.flushBackground()
    const sent: { targetId: ParticipantId; text: string }[] = []
    const commit = (senderId: ParticipantId, card: { targetId: ParticipantId | null; text: string } | undefined): void => {
      const c = card ?? { targetId: null, text: '' }
      session.commit({ type: 'SIGNAL_CARD_SENT', actor: senderId, payload: { senderId, targetId: c.targetId, text: c.text }, visibility: { kind: 'participants', ids: [senderId] } })
      if (c.targetId) sent.push({ targetId: c.targetId, text: c.text })
    }
    const humanDone = ctx.human.requestCard(oppositeGenderRule(session.state, human), config.validation.maxChars.card).then((c) => commit(human, c))
    const aiDone = Promise.all(enteredAiIds(ctx).map(async (id) => commit(id, await ctx.agents.signalCard(id, oppositeGenderRule(session.state, id)))))
    const timer = ctx.countdown('시그널 카드', ctx.scaled(config.timing.signalCardMs))
    await Promise.race([timer.promise, Promise.all([humanDone, aiDone])])
    ctx.human.expire('card')
    await humanDone
    await aiDone
    timer.cancel()
    for (const card of ctx.rng.shuffle(sent)) {
      session.commit({ type: 'SIGNAL_CARD_RECEIVED', payload: { recipientId: card.targetId, text: card.text }, visibility: { kind: 'participants', ids: [card.targetId] } })
    }
    ctx.house.announce('signal_card_done', PD.signalCardDone())
  },
}

export const day2Stages: StageHandler[] = [
  morning,
  brunch,
  catfishStage('D2_CATFISH_1', 0),
  freeTalk,
  catfishStage('D2_CATFISH_2', 1),
  activityChoice,
  activityTalks,
  regroup,
  signalCard,
  nightVoteStage('D2_NIGHT_VOTE'),
  nightTalksStage('D2_NIGHT_TALKS', 'D2_NIGHT_VOTE'),
  wrapStage('D2_WRAP', 2, '둘째 날'),
]
