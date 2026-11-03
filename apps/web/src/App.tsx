import { useMemo, useState } from 'react'
import type { HumanView, RoomView } from '@heart/shared'
import { ChatPane } from './components/ChatPane'
import { Onboarding } from './components/Onboarding'
import { ProfileCard } from './components/ProfileCard'
import { PromptSheet } from './components/PromptSheet'
import { Sidebar } from './components/Sidebar'
import { Banner, CastingScreen } from './components/StatusScreens'
import { useGame } from './state/useGame'
import styles from './App.module.css'

/** 방 목록 정렬: 지금 있는 방 → 최근 활동 순. PD 안내는 맨 아래. */
function orderedRooms(view: HumanView): RoomView[] {
  return Object.values(view.rooms).sort((a, b) => {
    if (a.kind === 'pd') return 1
    if (b.kind === 'pd') return -1
    const live = Number(b.isMember && b.status === 'open') - Number(a.isMember && a.status === 'open')
    return live || b.lastActivitySeq - a.lastActivitySeq
  })
}

const SIDEBAR_PREF = 'heart.sidebarOpen'

/** 사이드바 열림 상태는 이 브라우저에만 기억한다. 저장소를 못 쓰는 환경(사생활 보호 모드 등)이면 기본값(열림). */
function readSidebarPref(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_PREF) !== '0'
  } catch {
    return true
  }
}

function writeSidebarPref(open: boolean): void {
  try {
    localStorage.setItem(SIDEBAR_PREF, open ? '1' : '0')
  } catch {
    // 기억하지 못해도 동작에는 지장이 없다
  }
}

function lastSeq(view: HumanView, roomId: string): number {
  return view.messages[roomId]?.at(-1)?.seq ?? 0
}

function openMemberRooms(rooms: RoomView[]): string[] {
  return rooms.filter((r) => r.isMember && r.status === 'open' && r.kind !== 'pd').map((r) => r.id)
}

export function App() {
  const { view, timerSyncedAt, connection, send } = useGame()
  const rooms = useMemo(() => orderedRooms(view), [view])
  const member = useMemo(() => openMemberRooms(rooms), [rooms])
  const [selected, setSelected] = useState<string | null>(null)
  const [prevMember, setPrevMember] = useState<string[]>([])
  const [seen, setSeen] = useState<Record<string, number>>({})
  const [profileId, setProfileId] = useState<string | null>(null)
  const [dismissedRun, setDismissedRun] = useState<string | null>(null)
  const [sidebarOpen, setSidebarOpen] = useState(readSidebarPref)
  const toggleSidebar = (): void => {
    setSidebarOpen((open) => {
      writeSidebarPref(!open)
      return !open
    })
  }

  // 이전 렌더와 비교해 선택을 조정한다(effect 대신 렌더 중 조정, React 권장 패턴).
  // 새로 들어간 방(1:1 이동 등)으로 옮기고, 보고 있던 방에서 내가 나가게 된 순간에만 열린 방으로 옮긴다.
  // 사용자가 지난 방을 직접 골라 보는 것은 막지 않는다.
  if (member.join() !== prevMember.join()) {
    const fresh = member.find((id) => !prevMember.includes(id))
    const leftCurrent = selected !== null && prevMember.includes(selected) && !member.includes(selected)
    setPrevMember(member)
    if (fresh) setSelected(fresh)
    else if (leftCurrent) setSelected(member[0] ?? rooms[0]?.id ?? null)
  }
  const current = selected && view.rooms[selected] ? selected : (member[0] ?? rooms[0]?.id ?? null)
  if (current && seen[current] !== lastSeq(view, current)) setSeen({ ...seen, [current]: lastSeq(view, current) })

  const unread = useMemo(() => new Set(rooms.filter((r) => r.id !== current && lastSeq(view, r.id) > (seen[r.id] ?? 0)).map((r) => r.id)), [rooms, current, seen, view])

  const wantsNewRun = view.status === 'completed' && dismissedRun !== null && dismissedRun === view.runId
  if (view.status === 'idle' || wantsNewRun) {
    return (
      <div className={styles.app}>
        <Onboarding send={send} />
        {connection !== 'open' && <Banner text="서버에 연결하는 중…" bottom />}
      </div>
    )
  }
  if (view.status === 'casting') return <CastingScreen casting={view.casting} />

  const room = current ? (view.rooms[current] ?? null) : null
  const prompt = view.prompts[0]
  const profile = profileId ? view.participants[profileId] : undefined

  return (
    <div className={styles.app}>
      <button className={styles.menuButton} onClick={toggleSidebar} aria-label={sidebarOpen ? '채팅방 목록 닫기' : '채팅방 목록 열기'} aria-expanded={sidebarOpen}>
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden>
          <path d="M4 7h16M4 12h16M4 17h16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </button>
      <Sidebar view={view} rooms={rooms} selectedId={current} unread={unread} onSelect={setSelected} open={sidebarOpen} />
      <ChatPane
        view={view}
        timerSyncedAt={timerSyncedAt}
        room={room}
        onSend={async (roomId, text) => (await send({ type: 'sendMessage', roomId, text })).ok}
        onSkip={(roomId) => void send({ type: 'skipTalk', roomId })}
        onProfile={setProfileId}
      />
      {connection !== 'open' && <Banner text="연결이 끊겼어요. 다시 연결하는 중…" />}
      {connection === 'open' && view.status === 'paused' && view.pauseReason === 'disconnected' && <Banner text="일시정지됨" />}
      {view.status === 'completed' && (
        <Banner
          text={view.completedReason === 'crashed' ? '오류로 게임이 중단됐어요.' : view.completedReason === 'finished' ? '하트 하우스의 모든 일정이 끝났어요.' : '준비된 일정이 모두 끝났어요.'}
          action={{ label: '새 게임', onClick: () => setDismissedRun(view.runId) }}
        />
      )}
      {prompt && <PromptSheet key={prompt.id} view={view} prompt={prompt} send={send} />}
      {profile && !prompt && <ProfileCard participant={profile} onClose={() => setProfileId(null)} />}
    </div>
  )
}
