import { ballotsOf, firstImpressionRequests, packSlots, planNightTalks } from '@heart/engine'
import type { StageHandler } from '../director'
import { LIVING_ROOM } from '../house'
import { PD, formatMinutes } from '../pd'
import { Priority } from '../gpu-queue'
import { collectInvites, enteredAiIds, reflectOnLiving, runTalkSlot, runVote, startLiving, stopLiving } from './common'

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

const freeTalk: StageHandler = {
  id: 'D1_FREE_TALK',
  async run(ctx) {
    const ms = ctx.scaled(ctx.config.timing.freeTalkMs)
    ctx.house.announce('free_talk', PD.freeTalk(formatMinutes(ms)))
    if (!ctx.shared.living) startLiving(ctx)
    await ctx.countdown('자유 대화', ms).promise
    ctx.house.announce('free_talk_end', PD.freeTalkEnd())
    stopLiving(ctx)
    reflectOnLiving(ctx, ctx.shared.dayStartSeq, '첫 만남과 자유 대화')
  },
}

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

const regroup: StageHandler = {
  id: 'D1_REGROUP',
  async run(ctx) {
    ctx.house.announce('regroup', PD.regroup())
    startLiving(ctx)
    await ctx.countdown('휴식', ctx.scaled(ctx.config.timing.regroupMs)).promise
    stopLiving(ctx)
  },
}

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

const eveningTalk: StageHandler = {
  id: 'D1_EVENING_TALK',
  async run(ctx) {
    const ms = ctx.scaled(ctx.config.timing.eveningTalkMs)
    const since = ctx.session.state.lastSeq
    ctx.house.announce('evening_talk', PD.eveningTalk(formatMinutes(ms)))
    startLiving(ctx)
    await ctx.countdown('저녁 대화', ms).promise
    stopLiving(ctx)
    reflectOnLiving(ctx, since, '저녁 자기소개와 대화')
  },
}

const nightVote: StageHandler = {
  id: 'D1_NIGHT_VOTE',
  async run(ctx) {
    stopLiving(ctx)
    ctx.house.announce('night_vote', PD.nightVote())
    await ctx.agents.flushBackground()
    await runVote(ctx, 'D1_NIGHT_VOTE', 'night', '심야 선택', '오늘 밤 더 이야기하고 싶은 이성 한 명을 골라 주세요. 선택은 비공개입니다.')
  },
}

const nightTalks: StageHandler = {
  id: 'D1_NIGHT_TALKS',
  async run(ctx) {
    const voteId = ctx.shared.votes.D1_NIGHT_VOTE
    if (!voteId) throw new Error('night vote missing')
    const human = ctx.human.humanId
    const a = ctx.config.assignment
    const plan = planNightTalks(ballotsOf(ctx.session.state, voteId), human, {
      perAi: a.aiTalksPerAiPerNight,
      totalAiScenes: a.aiTalkScenesPerNight,
      minSlots: ctx.config.timing.minNightSlots,
    })
    ctx.session.commit({
      type: 'TALKS_PLANNED',
      payload: { stage: 'D1_NIGHT_TALKS', slots: plan.slots.map((s) => s.map((r) => ({ members: r.members, required: r.required }))), dropped: plan.dropped.map((r) => r.members) },
      visibility: { kind: 'server' },
    })
    const humanHasTalk = plan.slots.some((s) => s.some((r) => r.members.includes(human)))
    ctx.house.announce('night_talks', PD.nightTalks())
    if (!humanHasTalk) ctx.house.announce('no_night_talk', PD.noNightTalk(), { to: [human] })
    for (const slot of plan.slots) {
      await runTalkSlot(ctx, slot, { durationMs: ctx.scaled(ctx.config.timing.nightTalkMs), label: '심야 대화', idleNotice: humanHasTalk ? PD.idleSlot() : null })
    }
  },
}

const wrap: StageHandler = {
  id: 'D1_WRAP',
  async run(ctx) {
    stopLiving(ctx)
    ctx.house.announce('wrap', PD.wrap(1))
    for (const id of enteredAiIds(ctx)) ctx.agents.summarizeLater(id, ctx.shared.dayStartSeq, '첫째 날')
    const timer = ctx.countdown('하루 마무리', ctx.scaled(ctx.config.timing.wrapMs))
    await Promise.all([timer.promise, ctx.agents.flushBackground(Priority.P3_PD)])
  },
}

export const day1Stages: StageHandler[] = [arrival, freeTalk, firstVote, firstInvites, firstTalks, regroup, introduction, eveningTalk, nightVote, nightTalks, wrap]
