import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import { applyPatch, emptyHumanView, type Command, type HumanView, type ViewPatch } from '@signal/shared'
import { GameConnection, type CommandAck, type ConnectionStatus } from '../net/connection'

type Action = { type: 'snapshot'; view: HumanView } | { type: 'patches'; patches: ViewPatch[] }

function reducer(view: HumanView, action: Action): HumanView {
  if (action.type === 'snapshot') return action.view
  return action.patches.reduce(applyPatch, view)
}

export interface GameApi {
  view: HumanView
  /** 타이머 값을 마지막으로 받은 시각(performance.now). 화면 카운트다운의 기준점이다. */
  timerSyncedAt: number
  connection: ConnectionStatus
  send(command: Command): Promise<CommandAck>
}

/** 서버 상태를 화면 상태로 유지한다. 리듀서는 서버와 같은 applyPatch를 쓴다. */
export function useGame(): GameApi {
  const [view, dispatch] = useReducer(reducer, undefined, emptyHumanView)
  const [connection, setConnection] = useState<ConnectionStatus>('connecting')
  const [timerSyncedAt, setTimerSyncedAt] = useState(() => performance.now())
  const connRef = useRef<GameConnection | null>(null)

  useEffect(() => {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws'
    const conn = new GameConnection(`${proto}://${location.host}/ws`, {
      onSnapshot: (v) => {
        setTimerSyncedAt(performance.now())
        dispatch({ type: 'snapshot', view: v })
      },
      onPatches: (patches) => {
        if (patches.some((p) => p.type === 'timer' || p.type === 'reset')) setTimerSyncedAt(performance.now())
        dispatch({ type: 'patches', patches })
      },
      onStatus: setConnection,
    })
    connRef.current = conn
    // StrictMode의 이중 마운트에서 곧 버려질 소켓을 만들지 않도록 다음 tick에 연결한다.
    // (연결 중에 닫힌 소켓이 있으면 Chrome은 같은 호스트의 다음 핸드셰이크를 늦춘다.)
    const timer = setTimeout(() => conn.connect(), 0)
    return () => {
      clearTimeout(timer)
      conn.close()
    }
  }, [])

  const send = useCallback((command: Command) => connRef.current?.send(command) ?? Promise.resolve({ ok: false, error: 'offline' }), [])
  return { view, timerSyncedAt, connection, send }
}
