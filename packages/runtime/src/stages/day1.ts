import { ballotsOf, firstImpressionRequests, packSlots } from '@heart/engine'
import type { StageHandler } from '../director'
import { LIVING_ROOM } from '../house'
import { PD } from '../pd'
import { Priority } from '../gpu-queue'
import { collectInvites, enteredAiIds, runTalkSlot, runVote, startLiving, stopLiving } from './common'
import { livingStage, nightTalksStage, nightVoteStage, wrapStage } from './routines'

/** game-rules.md §4: 1일차 단계 핸들러. */

const arrival: StageHandler = {
  id: 'D1_ARRIVAL',
  async run(ctx) {
    const { house, session, config } = ctx
    const human = ctx.human.humanId
    ctx.shared.dayStartSeq = session.state.lastSeq
    house.openLiving()
    house.enterHouse(human)
    house.join(LIVING_ROOM, human)
    house.announce('welcome', PD.welcome())
    startLiving(ctx)
    const originals = [...session.state.participants.values()]
      .filter((p) => !p.cast.isHuman && !p.cast.isCatfish)
      .sort((a, b) => a.cast.entryOrder - b.cast.entryOrder)
    for (const p of originals) {
      await ctx.countdown('다음 입주자 도착', ctx.scaled(config.timing.arrivalIntervalMs)).promise
      house.enterHouse(p.cast.id)
      house.join(LIVING_ROOM, p.cast.id)
      house.announce('arrival', PD.arrival())
      const greeting = await ctx.agents.speak({ speakerId: p.cast.id, roomId: LIVING_ROOM, mode: 'greeting', isPrivate: false }, Priority.P1_SCENE)
      if (greeting) {
        ctx.shared.living?.primeReactions(2)
        house.say(LIVING_ROOM, p.cast.id, greeting, false)
      }
    }
  },
}

const freeTalk = livingStage('D1_FREE_TALK', {
  timerLabel: '자유 대화',
  ms: (t) => t.freeTalkMs,
  announce: PD.freeTalk,
  endAnnounce: PD.freeTalkEnd,
  reflect: '첫 만남과 자유 대화',
  reflectSince: 'day',
})

const firstVote: StageHandler = {
  id: 'D1_FIRST_VOTE',
  async run(ctx) {
    stopLiving(ctx)
    ctx.house.announce('first_vote', PD.firstVote())
    await ctx.agents.flushBackground()
    await runVote(ctx, 'D1_FIRST_VOTE', 'first_impression', '첫인상 선택', '가장 인상이 좋았던 이성 한 명을 골라 주세요. 선택은 비공개입니다.')
  },
}

const firstInvites: StageHandler = {
  id: 'D1_FIRST_INVITES',
  async run(ctx) {
    const voteId = ctx.shared.votes.D1_FIRST_VOTE
    if (!voteId) throw new Error('first vote missing')
    ctx.house.announce('invites', PD.invites())
    const accepted = await collectInvites(ctx, voteId)
    const requests = firstImpressionRequests(ballotsOf(ctx.session.state, voteId), accepted, ctx.human.humanId)
    const plan = packSlots(requests, ctx.config.timing.firstTalkSlots)
    ctx.shared.plans.D1_FIRST_TALKS = plan
    ctx.session.commit({
      type: 'TALKS_PLANNED',
      payload: { stage: 'D1_FIRST_TALKS', slots: plan.slots.map((s) => s.map((r) => ({ members: r.members, required: r.required }))), dropped: plan.dropped.map((r) => r.members) },
      visibility: { kind: 'server' },
    })
  },
}

const firstTalks: StageHandler = {
  id: 'D1_FIRST_TALKS',
  async run(ctx) {
    const plan = ctx.shared.plans.D1_FIRST_TALKS ?? { slots: [], dropped: [] }
    const human = ctx.human.humanId
    const humanHasTalk = plan.slots.some((s) => s.some((r) => r.members.includes(human)))
    ctx.house.announce('first_talks', PD.firstTalks())
    if (!humanHasTalk) ctx.house.announce('no_first_talk', PD.noFirstTalk(), { to: [human] })
    for (const slot of plan.slots) {
      await runTalkSlot(ctx, slot, { durationMs: ctx.scaled(ctx.config.timing.firstTalkSlotMs), label: '첫인상 대화', idleNotice: humanHasTalk ? PD.idleSlot() : null })
    }
  },
}

const regroup = livingStage('D1_REGROUP', { timerLabel: '휴식', ms: (t) => t.regroupMs, announce: () => PD.regroup() })

const introduction: StageHandler = {
  id: 'D1_INTRODUCTION',
  async run(ctx) {
    const { house, session, config } = ctx
    const human = ctx.human.humanId
    stopLiving(ctx)
    house.announce('intro_start', PD.introStart())
    const order = [human, ...enteredAiIds(ctx)]
    for (const id of order) {
      const cast = session.state.participants.get(id)?.cast
      if (!cast) continue
      house.announce('intro_call', PD.introCall(cast.name), { roomId: LIVING_ROOM })
      if (id === human) {
        const answer = ctx.human.requestIntro(config.validation.maxChars.intro)
        const timer = ctx.countdown('자기소개', ctx.scaled(config.timing.introTimeoutMs))
        const text = await Promise.race([answer, timer.promise.then(() => undefined)])
        timer.cancel()
        if (text === undefined) ctx.human.expire('intro')
        else house.say(LIVING_ROOM, human, text, false)
      } else {
        const text = (await ctx.agents.selfIntro(id, LIVING_ROOM)) ?? `안녕하세요, ${cast.age}살 ${cast.occupation} ${cast.name}입니다. 잘 부탁드려요.`
        house.say(LIVING_ROOM, id, text, false)
      }
      house.disclose(id, { age: cast.age, occupation: cast.occupation })
    }
  },
}

const eveningTalk = livingStage('D1_EVENING_TALK', { timerLabel: '저녁 대화', ms: (t) => t.eveningTalkMs, announce: PD.eveningTalk, reflect: '저녁 자기소개와 대화' })

const nightVote = nightVoteStage('D1_NIGHT_VOTE')
const nightTalks = nightTalksStage('D1_NIGHT_TALKS', 'D1_NIGHT_VOTE')
const wrap = wrapStage('D1_WRAP', 1, '첫째 날')

export const day1Stages: StageHandler[] = [arrival, freeTalk, firstVote, firstInvites, firstTalks, regroup, introduction, eveningTalk, nightVote, nightTalks, wrap]
