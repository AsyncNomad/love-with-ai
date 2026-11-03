import { useState } from 'react'
import type { Command, HumanView, PromptView } from '@heart/shared'
import { CandidateGrid } from './CandidateGrid'
import { Modal } from './Modal'
import styles from './PromptSheet.module.css'

type Send = (command: Command) => Promise<{ ok: boolean; error?: string }>

const ERRORS: Record<string, string> = {
  sender_name: '익명 카드에는 본인 이름을 쓸 수 없어요.',
  invalid_text: '내용을 확인해 주세요.',
}

const COPY = {
  card: {
    title: '시그널 카드',
    desc: '마음이 가는 사람에게 이름을 밝히지 않고 짧은 메시지를 보내요. 받는 사람은 누가 보냈는지 알 수 없어요.',
    placeholder: '함께 나눈 이야기를 떠올리게 하는 힌트는 괜찮아요',
    skip: '보내지 않기',
    submit: '카드 보내기',
  },
  mailboxAsk: {
    title: '시그널 우체통',
    desc: '더 알고 싶은 사람에게 질문 하나를 보내요. 질문과 답은 두 사람만 볼 수 있어요.',
    placeholder: '궁금한 것을 물어보세요',
    skip: '보내지 않기',
    submit: '질문 보내기',
  },
} as const

/** 대상 한 명 + 짧은 글: 시그널 카드(§5.5)와 우체통 질문(§6.1). */
export function TargetMessageSheet({ view, prompt, send }: { view: HumanView; prompt: Extract<PromptView, { kind: 'card' | 'mailboxAsk' }>; send: Send }) {
  const [target, setTarget] = useState<string | null>(null)
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const copy = COPY[prompt.kind]
  const submit = async (targetId: string | null): Promise<void> => {
    const command: Command = prompt.kind === 'card' ? { type: 'sendCard', targetId, text } : { type: 'askQuestion', targetId, text }
    const ack = await send(command)
    if (!ack.ok) setError(ERRORS[ack.error ?? ''] ?? '보내지 못했어요. 다시 시도해 주세요.')
  }
  return (
    <Modal title={copy.title} onClose={null}>
      <p className={styles.desc}>{copy.desc}</p>
      <CandidateGrid view={view} candidateIds={prompt.candidateIds} selected={target ? [target] : []} onToggle={(id) => setTarget(id === target ? null : id)} />
      <textarea className={`${styles.textarea} ${styles.spaced}`} value={text} maxLength={prompt.maxChars} rows={2} placeholder={copy.placeholder} onChange={(e) => setText(e.target.value)} />
      <p className={styles.counter}>
        {text.length} / {prompt.maxChars}
      </p>
      {error && <p className={styles.error}>{error}</p>}
      <div className={styles.actions}>
        <button className={styles.ghost} onClick={() => void submit(null)}>
          {copy.skip}
        </button>
        <button className={styles.primary} disabled={!target || !text.trim()} onClick={() => void submit(target)}>
          {copy.submit}
        </button>
      </div>
    </Modal>
  )
}

/** 받은 우체통 질문에 답한다(§6.1). */
export function MailboxAnswerSheet({ view, prompt, send }: { view: HumanView; prompt: Extract<PromptView, { kind: 'mailboxAnswer' }>; send: Send }) {
  const [text, setText] = useState('')
  const asker = view.participants[prompt.askerId]?.name ?? '누군가'
  return (
    <Modal title="우체통 답장" onClose={null}>
      <p className={styles.desc}>{asker} 님이 질문을 보냈어요. 답은 두 사람만 볼 수 있어요.</p>
      <blockquote className={styles.quote}>{prompt.question}</blockquote>
      <textarea className={styles.textarea} value={text} maxLength={prompt.maxChars} rows={3} placeholder="답장을 써 주세요" onChange={(e) => setText(e.target.value)} autoFocus />
      <div className={styles.actions}>
        <button className={styles.primary} disabled={!text.trim()} onClick={() => void send({ type: 'answerQuestion', questionId: prompt.questionId, text })}>
          답장 보내기
        </button>
      </div>
    </Modal>
  )
}
