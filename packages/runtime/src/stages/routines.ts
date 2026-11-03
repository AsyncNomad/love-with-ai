import type { StageId, TimingConfig } from '@heart/shared'
import { ballotsOf, planNightTalks } from '@heart/engine'
import type { StageHandler } from '../director'
import { Priority } from '../gpu-queue'
import { PD, formatMinutes } from '../pd'
import { enteredAiIds, reflectOnLiving, runTalkSlot, runVote, startLiving, stopLiving } from './common'

/** 여러 날에 반복되는 단계(거실 대화, 심야 선택·대화, 하루 마무리)의 팩토리. */

export interface LivingOptions {
  timerLabel: string
  ms: (t: TimingConfig) => number
  announce: (min: string) => string
  endAnnounce?: () => string
  /** 끝난 뒤 인상을 갱신할 때 쓰는 장면 이름. 없으면 갱신하지 않는다. */
  reflect?: string
  /** 'day'면 그날 시작부터의 대화를 근거로 삼는다(1일차 첫 자유 대화는 입장 인사부터 본다). */
  reflectSince?: 'stage' | 'day'
  /** 새 날의 첫 단계. 하루 요약의 시작점을 여기로 옮긴다. */
  startsDay?: boolean
}

/** 거실 자유 대화. 이미 돌고 있는 거실 장면(입장·메기 인사)이 있으면 이어서 쓴다. */
export function livingStage(id: StageId, o: LivingOptions): StageHandler {
  return {
    id,
    async run(ctx) {
      if (o.startsDay) ctx.shared.dayStartSeq = ctx.session.state.lastSeq
      const since = o.reflectSince === 'day' ? ctx.shared.dayStartSeq : ctx.session.state.lastSeq
      const ms = ctx.scaled(o.ms(ctx.config.timing))
      ctx.house.announce(id.toLowerCase(), o.announce(formatMinutes(ms)))
      if (!ctx.shared.living) startLiving(ctx)
      await ctx.countdown(o.timerLabel, ms).promise
      if (o.endAnnounce) ctx.house.announce(`${id.toLowerCase()}_end`, o.endAnnounce())
      stopLiving(ctx)
      if (o.reflect) reflectOnLiving(ctx, since, o.reflect)
    },
  }
}

/** 심야 선택(game-rules.md §4.4, §5.6). 투표 전에 밀린 관계 평가를 끝낸다. */
export function nightVoteStage(id: StageId): StageHandler {
  return {
    id,
    async run(ctx) {
      stopLiving(ctx)
      ctx.house.announce('night_vote', PD.nightVote())
      await ctx.agents.flushBackground()
      await runVote(ctx, id, 'night', '심야 선택', '오늘 밤 더 이야기하고 싶은 이성 한 명을 골라 주세요. 선택은 비공개입니다.')
    },
  }
}

/** 심야 대화(game-rules.md §8.1, §8.3). 사람의 필수 1:1과 AI끼리의 대화를 같은 슬롯에 넣는다. */
export function nightTalksStage(id: StageId, voteStage: StageId): StageHandler {
  return {
    id,
    async run(ctx) {
      const voteId = ctx.shared.votes[voteStage]
      if (!voteId) throw new Error(`${voteStage} missing`)
      const human = ctx.human.humanId
      const a = ctx.config.assignment
      const plan = planNightTalks(ballotsOf(ctx.session.state, voteId), human, {
        perAi: a.aiTalksPerAiPerNight,
        totalAiScenes: a.aiTalkScenesPerNight,
        minSlots: ctx.config.timing.minNightSlots,
      })
      ctx.shared.plans[id] = plan
      ctx.session.commit({
        type: 'TALKS_PLANNED',
        payload: { stage: id, slots: plan.slots.map((s) => s.map((r) => ({ members: r.members, required: r.required }))), dropped: plan.dropped.map((r) => r.members) },
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
}

/** 하루 마무리(game-rules.md §3): 모든 AI의 하루 기억을 요약하고, 끝날 때까지 다음 날을 시작하지 않는다. */
export function wrapStage(id: StageId, day: number, label: string): StageHandler {
  return {
    id,
    async run(ctx) {
      stopLiving(ctx)
      ctx.house.announce('wrap', PD.wrap(day))
      for (const aid of enteredAiIds(ctx)) ctx.agents.summarizeLater(aid, ctx.shared.dayStartSeq, label)
      const timer = ctx.countdown('하루 마무리', ctx.scaled(ctx.config.timing.wrapMs))
      await Promise.all([timer.promise, ctx.agents.flushBackground(Priority.P3_PD)])
    },
  }
}
