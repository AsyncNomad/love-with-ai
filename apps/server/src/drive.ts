import type { ClientMessage, Command, HumanProfile, HumanView, ServerMessage } from '@heart/shared'
import { applyPatch, emptyHumanView } from '@heart/shared'

/**
 * 실행 중인 서버에 사람으로 붙어 한 판을 자동으로 진행한다(실제 모델 E2E용).
 * 화면과 같은 WebSocket 프로토콜만 쓴다. 선택 창에는 답하고, 가끔 지금 있는 방에 말을 건다.
 */

export interface DriveOptions {
  url: string
  profile: HumanProfile | null
  chatEveryMs: number
  log: (line: string) => void
}

/** 같은 문장을 되풀이하면 AI가 대화를 그 화제로만 끌고 가고, 사람을 "반복이 심하다"고 평가한다(실측). 최근에 쓴 문장은 피한다. */
const LINES = [
  '저는 영화 보는 거 좋아해요. 최근에 본 거 있으세요?',
  '그 얘기 재밌네요. 조금 더 듣고 싶어요',
  '여기 분위기 생각보다 편하네요',
  '음식은 뭐 좋아하세요?',
  '저는 주말에 한강에서 자주 뛰어요',
  '아 그렇구나, 저랑은 좀 다르네요',
  '요즘 일이 바빠서 쉬는 날이 소중해요',
  '여행 가면 계획 세우는 편이세요?',
  '오늘 하루 어떠셨어요?',
  '저도 비슷하게 생각해요',
  '커피보다는 차를 더 좋아해요',
  '처음엔 어색했는데 이제 좀 편해졌어요',
]

/**
 * AI가 사람에게 질문하면 그 질문에 맞춰 대답한다. 맥락 없는 문장만 던지면 AI의 대화 품질을 제대로 볼 수 없다(실측).
 * 낱말 → 대답 표다. 맞는 낱말이 없으면 무난한 대답을 쓴다.
 */
const ANSWERS: [RegExp, string][] = [
  [/영화|드라마/, '요즘은 스릴러를 자주 봐요. 무서운 건 잘 못 보고요'],
  [/운동|러닝|뛰/, '주말 아침에 한강에서 5킬로 정도 뛰어요'],
  [/음식|먹|맛집|요리/, '매운 거 좋아해요. 떡볶이는 일주일에 한 번은 먹어요'],
  [/여행|계획/, '즉흥적으로 떠나는 편이에요. 계획은 숙소 정도만 잡아요'],
  [/일|직업|회사|개발/, '개발자로 일해요. 요즘 마감이라 좀 바빠요'],
  [/쉬는 날|주말|휴일/, '보통 늦잠 자고 동네 카페 가요'],
  [/커피|차/, '커피는 잘 못 마셔서 차를 마셔요'],
  [/기분|어떠|어땠|괜찮/, '처음엔 긴장됐는데 지금은 편해요'],
  [/연애|이상형|좋아하는 사람/, '대화가 편한 사람이 좋아요'],
  [/음악|노래/, '잔잔한 인디 음악 자주 들어요'],
]

const FALLBACK_ANSWERS = ['음, 그건 생각해 본 적이 없네요', '저는 반반이에요', '그때그때 달라요', '좋아하는 편이에요', '잘 모르겠어요, 그쪽 얘기가 더 궁금해요']

/** 같은 방에서 같은 대답을 두 번 하지 않는다(실측: 같은 대답을 되풀이해 AI가 그 말을 계속 붙잡았다). */
function answerFor(question: string, used: Set<string>): string {
  const candidates = [...ANSWERS.filter(([re]) => re.test(question)).map(([, a]) => a), ...FALLBACK_ANSWERS]
  const pick = candidates.find((a) => !used.has(a)) ?? (FALLBACK_ANSWERS[0] as string)
  used.add(pick)
  return pick
}

export function drive(opts: DriveOptions): Promise<string> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(opts.url)
    let view: HumanView = emptyHumanView()
    let counter = 0
    let created = false
    const answered = new Set<string>()
    const recentLines: string[] = []
    const answeredSeqs = new Set<number>()
    const usedAnswers = new Map<string, Set<string>>()
    const send = (command: Command): void => {
      const msg: ClientMessage = { type: 'command', commandId: `drive-${++counter}`, command }
      ws.send(JSON.stringify(msg))
    }
    const chat = setInterval(() => {
      if (view.status !== 'running') return
      const rooms = Object.values(view.rooms)
        .filter((r) => r.kind !== 'pd' && r.isMember && r.status === 'open')
        .sort((a, b) => b.lastActivitySeq - a.lastActivitySeq)
      const room = rooms[0]
      if (!room) return
      const fresh = LINES.filter((l) => !recentLines.includes(l))
      const line = fresh[Math.floor(Math.random() * fresh.length)] ?? (LINES[0] as string)
      recentLines.push(line)
      if (recentLines.length > 6) recentLines.shift()
      send({ type: 'sendMessage', roomId: room.id, text: line })
    }, opts.chatEveryMs)

    // 내가 있는 방의 마지막 말이 질문이면, 사람이 읽고 치는 시간(약 5초) 뒤에 그 질문에 대답한다.
    const maybeAnswer = (): void => {
      if (view.status !== 'running') return
      for (const room of Object.values(view.rooms)) {
        if (room.kind === 'pd' || !room.isMember || room.status !== 'open') continue
        const last = view.messages[room.id]?.at(-1)
        const mine = last?.senderId === view.meId || (last?.senderId ? view.participants[last.senderId]?.isMe : false)
        if (!last || last.kind !== 'chat' || mine || !last.text.trim().endsWith('?') || answeredSeqs.has(last.seq)) continue
        answeredSeqs.add(last.seq)
        const used = usedAnswers.get(room.id) ?? new Set<string>()
        usedAnswers.set(room.id, used)
        setTimeout(() => send({ type: 'sendMessage', roomId: room.id, text: answerFor(last.text, used) }), 5000)
      }
    }

    const react = (): void => {
      maybeAnswer()
      if (opts.profile && !created && (view.status === 'idle' || view.status === 'completed') && view.runId === null) {
        created = true
        send({ type: 'createRun', profile: opts.profile })
      }
      for (const p of view.prompts) {
        if (answered.has(p.id)) continue
        answered.add(p.id)
        setTimeout(() => {
          if (p.kind === 'vote') send({ type: 'submitVote', voteId: p.voteId, targetId: p.candidateIds[0] ?? null })
          else if (p.kind === 'invite') send({ type: 'respondInvite', voteId: p.voteId, acceptIds: p.candidateIds.slice(0, 1) })
          else if (p.kind === 'intro') send({ type: 'submitIntro', text: '안녕하세요, 영화랑 러닝 좋아하는 사람이에요. 잘 부탁드려요!' })
          else if (p.kind === 'resume') send({ type: 'resume' })
          else if (p.kind === 'activity') send({ type: 'chooseActivity', first: p.options[0]?.id ?? '', second: p.options[1]?.id ?? '' })
          else if (p.kind === 'card') send({ type: 'sendCard', targetId: p.candidateIds[0] ?? null, text: '같이 이야기한 시간이 제일 즐거웠어요.' })
          else if (p.kind === 'mailboxAsk') send({ type: 'askQuestion', targetId: p.candidateIds[0] ?? null, text: '여기서 가장 기억에 남는 순간은 언제예요?' })
          else if (p.kind === 'mailboxAnswer') send({ type: 'answerQuestion', questionId: p.questionId, text: '어제 밤에 나눈 대화가 제일 기억에 남아요.' })
          else if (p.kind === 'epilogue') send({ type: 'closeEpilogue' })
        }, 1500)
      }
      // 같은 선택 창에 두 번 답하지 않도록, 창이 사라진 뒤에만 잊는다.
      for (const id of [...answered]) if (!view.prompts.some((p) => p.id === id)) answered.delete(id)
      if (view.status === 'completed' && created) {
        clearInterval(chat)
        ws.close()
        resolve(view.completedReason ?? 'completed')
      }
    }

    ws.onopen = () => ws.send(JSON.stringify({ type: 'hello' } satisfies ClientMessage))
    ws.onerror = () => reject(new Error(`cannot connect to ${opts.url}`))
    ws.onmessage = (ev: { data: unknown }) => {
      const msg = JSON.parse(String(ev.data)) as ServerMessage
      if (msg.type === 'snapshot') view = msg.view
      else if (msg.type === 'patch') {
        for (const p of msg.patches) {
          const prevStage = view.stage?.id
          view = applyPatch(view, p)
          if (p.type === 'stage' && view.stage && view.stage.id !== prevStage) opts.log(`stage ${view.stage.id}`)
        }
      } else if (msg.type === 'ack' && !msg.ok) opts.log(`command rejected: ${msg.error ?? ''}`)
      react()
    }
  })
}
