import type { HumanView, PromptView } from '@signal/shared'
import type { Rng } from '@signal/engine'
import type { Game, TimerHost } from '@signal/runtime'

const LINES = ['안녕하세요!', '다들 뭐 좋아하세요?', 'ㅋㅋㅋ 그거 저도요', '오늘 분위기 좋네요', '혹시 운동 하세요?', '저는 영화 보는 거 좋아해요']

/**
 * 헤드리스 시뮬레이션용 자동 플레이어. 실제 사람과 같은 명령 경로(gateway)만 쓴다.
 */
export class SimHuman {
  private commandCounter = 0
  private readonly answered = new Set<string>()
  private chatHandle: unknown = null

  constructor(
    private readonly game: Game,
    private readonly rng: Rng,
    private readonly host: TimerHost,
    private readonly opts: { chatIntervalMs: { min: number; max: number }; respondDelayMs: { min: number; max: number } },
  ) {
    game.projector.subscribe(() => this.onView(game.projector.snapshot()))
    this.scheduleChat()
  }

  stop(): void {
    this.host.clearTimeout(this.chatHandle)
  }

  private send(command: Parameters<Game['handle']>[1]): void {
    this.game.handle(`sim_${++this.commandCounter}`, command)
  }

  private onView(view: HumanView): void {
    for (const prompt of view.prompts) {
      if (this.answered.has(prompt.id)) continue
      this.answered.add(prompt.id)
      const delay = this.rng.int(this.opts.respondDelayMs.min, this.opts.respondDelayMs.max)
      this.host.setTimeout(() => this.answer(prompt), delay)
    }
  }

  private answer(prompt: PromptView): void {
    switch (prompt.kind) {
      case 'vote':
        this.send({ type: 'submitVote', voteId: prompt.voteId, targetId: this.rng.chance(0.15) ? null : this.rng.pick(prompt.candidateIds) })
        break
      case 'invite':
        this.send({ type: 'respondInvite', voteId: prompt.voteId, acceptIds: this.rng.shuffle(prompt.candidateIds).slice(0, this.rng.int(0, prompt.maxAccept)) })
        break
      case 'intro':
        this.send({ type: 'submitIntro', text: '안녕하세요, 잘 부탁드립니다!' })
        break
      case 'resume':
        this.send({ type: 'resume' })
        break
    }
    this.answered.delete(prompt.id)
  }

  private scheduleChat(): void {
    const { min, max } = this.opts.chatIntervalMs
    this.chatHandle = this.host.setTimeout(() => {
      const view = this.game.projector.snapshot()
      if (view.status === 'completed') return
      const rooms = Object.values(view.rooms).filter((r) => r.kind !== 'pd' && r.isMember && r.status === 'open')
      if (view.status === 'running' && rooms.length > 0) {
        const room = this.rng.pick(rooms)
        this.send({ type: 'sendMessage', roomId: room.id, text: this.rng.pick(LINES) })
      }
      this.scheduleChat()
    }, this.rng.int(min, max))
  }
}
