import type { EpilogueView, ParticipantId } from '@heart/shared'
import { STAGE_META } from '@heart/shared'
import { ballotsOf, mutualPairs, oppositeGenderRule, planFinalDates } from '@heart/engine'
import type { StageContext, StageHandler } from '../director'
import { PD } from '../pd'
import { enteredAiIds, runTalkSlot, runVote, stopLiving } from './common'
import { livingStage } from './routines'

/** game-rules.md §6: 3일차 단계 핸들러. */

const opening = livingStage('D3_OPENING', { timerLabel: '마지막 날 아침', ms: (t) => t.openingMs, announce: () => PD.opening(), startsDay: true })

interface Question {
  questionId: string
  askerId: ParticipantId
  targetId: ParticipantId
  text: string
}

/**
 * 시그널 우체통(§6.1). 질문 단계와 답 단계로 나눈다. 제한 시간(mailboxMs)은 질문 40%, 답 60%로 쓴다.
 * 질문과 답은 두 사람만 보고, 끝나면 두 사람 모두 서로에 대한 인상을 갱신한다.
 */
const mailbox: StageHandler = {
  id: 'D3_MAILBOX',
  async run(ctx) {
    stopLiving(ctx)
    const { session, config, house } = ctx
    const human = ctx.human.humanId
    const max = config.validation.maxChars.mailbox
    const since = session.state.lastSeq
    house.announce('mailbox', PD.mailbox())
    await ctx.agents.flushBackground()

    const questions: Question[] = []
    const ask = (askerId: ParticipantId, q: { targetId: ParticipantId | null; text: string } | undefined): void => {
      if (!q?.targetId) return
      const question: Question = { questionId: `q_${questions.length + 1}`, askerId, targetId: q.targetId, text: q.text }
      questions.push(question)
      session.commit({ type: 'MAILBOX_QUESTION', actor: askerId, payload: question, visibility: { kind: 'participants', ids: [askerId, q.targetId] } })
    }
    const humanAsked = ctx.human.requestQuestion(oppositeGenderRule(session.state, human), max).then((q) => ask(human, q))
    const aiAsked = Promise.all(enteredAiIds(ctx).map(async (id) => ask(id, await ctx.agents.mailboxQuestion(id, oppositeGenderRule(session.state, id)))))
    const askTimer = ctx.countdown('우체통 질문', ctx.scaled(config.timing.mailboxMs * 0.4))
    await Promise.race([askTimer.promise, Promise.all([humanAsked, aiAsked])])
    ctx.human.expire('mailboxAsk')
    await humanAsked
    await aiAsked
    askTimer.cancel()

    if (questions.length > 0) {
      house.announce('mailbox_answers', PD.mailboxAnswers())
      const answer = (q: Question, text: string | null | undefined): void => {
        if (!text) return
        session.commit({ type: 'MAILBOX_ANSWER', actor: q.targetId, payload: { questionId: q.questionId, answererId: q.targetId, text }, visibility: { kind: 'participants', ids: [q.askerId, q.targetId] } })
      }
      const jobs = questions.map(async (q) => {
        if (q.targetId === human) answer(q, await ctx.human.requestAnswer(q.questionId, q.askerId, q.text, max))
        else answer(q, await ctx.agents.mailboxAnswer(q.targetId, q.askerId, q.text))
      })
      const answerTimer = ctx.countdown('우체통 답장', ctx.scaled(config.timing.mailboxMs * 0.6))
      const all = Promise.all(jobs)
      await Promise.race([answerTimer.promise, all])
      for (const q of questions) if (q.targetId === human) ctx.human.expire(`answer:${q.questionId}`)
      await all
      answerTimer.cancel()
      for (const q of questions) {
        if (q.askerId !== human) ctx.agents.reflectLater(q.askerId, [q.targetId], since, '시그널 우체통')
        if (q.targetId !== human) ctx.agents.reflectLater(q.targetId, [q.askerId], since, '시그널 우체통')
      }
    }
    house.announce('mailbox_done', PD.mailboxDone())
  },
}

const dateChoice: StageHandler = {
  id: 'D3_DATE_CHOICE',
  async run(ctx) {
    stopLiving(ctx)
    ctx.house.announce('date_choice', PD.dateChoice())
    await ctx.agents.flushBackground()
    const voteId = await runVote(ctx, 'D3_DATE_CHOICE', 'date', '마지막 데이트 선택', '마지막 날 단둘이 데이트하고 싶은 이성 한 명을 골라 주세요. 선택은 비공개입니다.', {
      timeoutMs: ctx.config.timing.dateChoiceMs,
    })
    const plan = planFinalDates(ballotsOf(ctx.session.state, voteId), ctx.human.humanId, ctx.config.timing.finalDateSlots)
    ctx.shared.plans.D3_FINAL_DATES = plan
    ctx.session.commit({
      type: 'TALKS_PLANNED',
      payload: { stage: 'D3_FINAL_DATES', slots: plan.slots.map((s) => s.map((r) => ({ members: r.members, required: r.required }))), dropped: plan.dropped.map((r) => r.members) },
      visibility: { kind: 'server' },
    })
  },
}

const finalDates: StageHandler = {
  id: 'D3_FINAL_DATES',
  async run(ctx) {
    const plan = ctx.shared.plans.D3_FINAL_DATES ?? { slots: [], dropped: [] }
    const human = ctx.human.humanId
    const places = ctx.config.events.dateLocations
    const humanHasDate = plan.slots.some((s) => s.some((r) => r.members.includes(human)))
    ctx.house.announce('final_dates', PD.finalDates())
    if (!humanHasDate) ctx.house.announce('no_final_date', PD.noFinalDate(), { to: [human] })
    let placeCursor = 0
    for (const slot of plan.slots) {
      await runTalkSlot(ctx, slot, {
        durationMs: ctx.scaled(ctx.config.timing.finalDateMs),
        label: '마지막 데이트',
        idleNotice: humanHasDate ? PD.idleSlot() : null,
        locationOf: () => places[placeCursor++ % places.length] ?? '카페',
      })
    }
  },
}

const lastDinner = livingStage('D3_LAST_DINNER', { timerLabel: '마지막 저녁', ms: (t) => t.lastDinnerMs, announce: PD.lastDinner, reflect: '마지막 저녁' })

/** 최종 선택(§6.4). 사람이 직접 제출할 때까지 기다리고, 대상을 임의로 고르지 않는다. */
const finalVote: StageHandler = {
  id: 'D3_FINAL_VOTE',
  async run(ctx) {
    stopLiving(ctx)
    ctx.house.announce('final_vote', PD.finalVote())
    await ctx.agents.flushBackground()
    await runVote(ctx, 'D3_FINAL_VOTE', 'final', '최종 선택', '3일을 돌아보고 마음이 가는 이성 한 명을 골라 주세요. 서로를 고른 경우에만 커플이 됩니다.', { timeoutMs: null })
  },
}

function nameOf(ctx: StageContext, id: ParticipantId): string {
  return ctx.session.state.participants.get(id)?.cast.name ?? '?'
}

/**
 * 결과 발표(§6.4). 매칭은 서로를 고른 쌍뿐이다. 결과를 바꾸는 코드 경로는 없다.
 * 공개 범위: 사람에게는 본인 선택·상대의 선택·성사 여부를, 하우스 전체에는 성사된 커플 목록만 알린다.
 */
const resultReveal: StageHandler = {
  id: 'RESULT_REVEAL',
  async run(ctx) {
    const { session, house } = ctx
    const human = ctx.human.humanId
    const voteId = ctx.shared.votes.D3_FINAL_VOTE
    if (!voteId) throw new Error('final vote missing')
    const ballots = ballotsOf(session.state, voteId)
    const pairs = mutualPairs(ballots)
    session.commit({ type: 'MATCHES_COMPUTED', payload: { voteId, pairs }, visibility: { kind: 'server' } })
    const step = (): Promise<void> => ctx.clock.sleep(ctx.scaled(ctx.config.timing.revealStepMs))

    house.announce('reveal_start', PD.revealStart())
    await step()
    const humanPick = ballots.get(human) ?? null
    house.announce('reveal_human_pick', PD.revealHumanPick(humanPick ? nameOf(ctx, humanPick) : null), { to: [human] })
    await step()
    let partnerPick: ParticipantId | null = null
    if (humanPick) {
      partnerPick = ballots.get(humanPick) ?? null
      house.announce('reveal_partner_pick', PD.revealPartnerPick(nameOf(ctx, humanPick), partnerPick === human ? 'you' : partnerPick ? nameOf(ctx, partnerPick) : null), { to: [human] })
      await step()
      house.announce('reveal_outcome', PD.revealOutcome(partnerPick === human), { to: [human] })
      await step()
    }
    house.announce('reveal_couples', PD.revealCouples(pairs.map(([a, b]) => `${nameOf(ctx, a)}·${nameOf(ctx, b)}`)))
    await step()
    house.announce('closing', PD.closing())
    ctx.shared.result = { pairs, humanPick, partnerPick }
  },
}

/** 에필로그(§6.5): 사람 본인의 날짜별 선택과 공식 결과. 사람이 닫으면 회차가 끝난다. */
const epilogue: StageHandler = {
  id: 'EPILOGUE',
  async run(ctx) {
    const state = ctx.session.state
    const human = ctx.human.humanId
    const result = ctx.shared.result ?? { pairs: [], humanPick: null, partnerPick: null }
    const myChoices = [...state.votes.values()]
      .sort((a, b) => a.openedSeq - b.openedSeq)
      .map((v) => ({ label: `${STAGE_META[v.stage].day}일차 ${STAGE_META[v.stage].label}`, targetId: v.ballots.get(human)?.targetId ?? null }))
    const view: EpilogueView = {
      myChoices,
      finalPick: result.humanPick,
      partnerPick: result.partnerPick,
      matched: result.humanPick !== null && result.partnerPick === human,
      couples: result.pairs,
    }
    await ctx.human.showEpilogue(view)
  },
}

export const day3Stages: StageHandler[] = [opening, mailbox, dateChoice, finalDates, lastDinner, finalVote, resultReveal, epilogue]
