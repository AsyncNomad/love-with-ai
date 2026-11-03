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

const LINES = [
  '안녕하세요! 다들 반가워요',
  '혹시 쉬는 날엔 뭐 하세요?',
  '저는 영화 보는 거 좋아해요. 최근에 본 거 있으세요?',
  'ㅋㅋㅋ 그거 저도 공감돼요',
  '러닝 하시는 분 계세요? 같이 뛸 사람 찾고 있어요',
  '여기 분위기 생각보다 편하네요',
  '음식은 뭐 좋아하세요?',
]

export function drive(opts: DriveOptions): Promise<string> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(opts.url)
    let view: HumanView = emptyHumanView()
    let counter = 0
    let created = false
    const answered = new Set<string>()
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
      if (room) send({ type: 'sendMessage', roomId: room.id, text: LINES[Math.floor(Math.random() * LINES.length)] as string })
    }, opts.chatEveryMs)

    const react = (): void => {
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
          answered.delete(p.id)
        }, 1500)
      }
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
