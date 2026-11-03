import { useState } from 'react'
import type { Command, HumanView, PromptView } from '@heart/shared'
import { ActivitySheet } from './ActivitySheet'
import { CandidateGrid } from './CandidateGrid'
import { EpilogueSheet } from './EpilogueSheet'
import { MailboxAnswerSheet, TargetMessageSheet } from './MessageSheets'
import { Modal } from './Modal'
import styles from './PromptSheet.module.css'

interface Props {
  view: HumanView
  prompt: PromptView
  send(command: Command): Promise<{ ok: boolean; error?: string }>
}

/** 서버가 사람에게 묻는 선택: 투표, 초대 수락, 자기소개, 활동, 카드, 우체통, 에필로그, 재개. */
export function PromptSheet({ view, prompt, send }: Props) {
  switch (prompt.kind) {
    case 'vote':
      return <VoteSheet view={view} prompt={prompt} send={send} />
    case 'invite':
      return <InviteSheet view={view} prompt={prompt} send={send} />
    case 'intro':
      return <IntroSheet prompt={prompt} send={send} />
    case 'activity':
      return <ActivitySheet prompt={prompt} send={send} />
    case 'card':
    case 'mailboxAsk':
      return <TargetMessageSheet view={view} prompt={prompt} send={send} />
    case 'mailboxAnswer':
      return <MailboxAnswerSheet view={view} prompt={prompt} send={send} />
    case 'epilogue':
      return <EpilogueSheet view={view} prompt={prompt} send={send} />
    case 'resume':
      return (
        <Modal title="일시정지" onClose={null}>
          <p className={styles.desc}>{prompt.reason === 'llm_unavailable' ? 'AI 서버에 연결할 수 없어 게임을 멈췄습니다. 서버를 확인한 뒤 다시 시도해 주세요.' : '자리를 비운 것 같아 대화를 멈췄습니다.'}</p>
          <button className={styles.primary} onClick={() => void send({ type: 'resume' })}>
            다시 시작
          </button>
        </Modal>
      )
  }
}

function VoteSheet({ view, prompt, send }: Props & { prompt: Extract<PromptView, { kind: 'vote' }> }) {
  const [choice, setChoice] = useState<string | null>(null)
  // 두 번 확인(최종 선택): 첫 클릭은 확인할 대상을 기억만 한다. undefined면 확인 중이 아니다.
  const [confirmTarget, setConfirmTarget] = useState<string | null | undefined>(undefined)
  const [error, setError] = useState<string | null>(null)
  const submit = async (target: string | null): Promise<void> => {
    if (prompt.confirmTwice && confirmTarget !== target) {
      setConfirmTarget(target)
      return
    }
    const ack = await send({ type: 'submitVote', voteId: prompt.voteId, targetId: target })
    if (!ack.ok) setError('제출하지 못했어요. 다시 시도해 주세요.')
  }
  if (confirmTarget !== undefined) {
    const name = confirmTarget ? (view.participants[confirmTarget]?.name ?? '?') : null
    return (
      <Modal title={prompt.title} onClose={null}>
        <p className={styles.desc}>{name ? `${name} 님을 최종 선택할까요? 제출하면 바꿀 수 없어요.` : '아무도 선택하지 않을까요? 제출하면 바꿀 수 없어요.'}</p>
        {error && <p className={styles.error}>{error}</p>}
        <div className={styles.actions}>
          <button className={styles.ghost} onClick={() => setConfirmTarget(undefined)}>
            다시 고르기
          </button>
          <button className={styles.primary} onClick={() => void submit(confirmTarget)}>
            확정하기
          </button>
        </div>
      </Modal>
    )
  }
  return (
    <Modal title={prompt.title} onClose={null}>
      <p className={styles.desc}>{prompt.description}</p>
      <CandidateGrid view={view} candidateIds={prompt.candidateIds} selected={choice ? [choice] : []} onToggle={setChoice} />
      {error && <p className={styles.error}>{error}</p>}
      <div className={styles.actions}>
        {prompt.allowAbstain && (
          <button className={styles.ghost} onClick={() => void submit(null)}>
            선택하지 않기
          </button>
        )}
        <button className={styles.primary} disabled={!choice} onClick={() => void submit(choice)}>
          선택 완료
        </button>
      </div>
    </Modal>
  )
}

function InviteSheet({ view, prompt, send }: Props & { prompt: Extract<PromptView, { kind: 'invite' }> }) {
  const [picked, setPicked] = useState<string[]>([])
  const toggle = (id: string): void =>
    setPicked((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : cur.length < prompt.maxAccept ? [...cur, id] : cur))
  return (
    <Modal title="대화 초대" onClose={null}>
      <p className={styles.desc}>첫인상 선택에서 당신을 고른 사람들이에요. 따로 이야기할 사람을 최대 {prompt.maxAccept}명 골라 주세요.</p>
      <CandidateGrid view={view} candidateIds={prompt.candidateIds} selected={picked} onToggle={toggle} showMeta={false} />
      <div className={styles.actions}>
        <button className={styles.ghost} onClick={() => void send({ type: 'respondInvite', voteId: prompt.voteId, acceptIds: [] })}>
          모두 거절
        </button>
        <button className={styles.primary} disabled={picked.length === 0} onClick={() => void send({ type: 'respondInvite', voteId: prompt.voteId, acceptIds: picked })}>
          대화하기
        </button>
      </div>
    </Modal>
  )
}

function IntroSheet({ prompt, send }: { prompt: Extract<PromptView, { kind: 'intro' }>; send: Props['send'] }) {
  const [text, setText] = useState('')
  return (
    <Modal title="자기소개" onClose={null}>
      <p className={styles.desc}>PD가 당신을 호명했어요. 나이와 직업은 프로필 값으로 자동 공개됩니다.</p>
      <textarea className={styles.textarea} value={text} maxLength={prompt.maxChars} rows={3} placeholder="안녕하세요, 저는…" onChange={(e) => setText(e.target.value)} autoFocus />
      <div className={styles.actions}>
        <button className={styles.primary} disabled={!text.trim()} onClick={() => void send({ type: 'submitIntro', text })}>
          말하기
        </button>
      </div>
    </Modal>
  )
}
