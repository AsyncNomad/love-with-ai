import type { CallRecord, DeliveryRecord } from '@signal/agents'
import type { AnyEvent } from '@signal/shared'

/** 회차 기록 저장소. SqliteRunStore가 구조적으로 만족한다. */
export interface RunSink {
  append(event: AnyEvent): void
  recordDelivery(d: DeliveryRecord): void
  recordCall(c: CallRecord): void
}

/** 프로필 사진 저장소. 돌려준 URL을 화면에서 쓴다. */
export interface AvatarStore {
  save(runId: string, participantId: string, png: Uint8Array): Promise<string>
}

export class MemorySink implements RunSink {
  readonly events: AnyEvent[] = []
  readonly deliveries: DeliveryRecord[] = []
  readonly calls: CallRecord[] = []
  append(event: AnyEvent): void {
    this.events.push(event)
  }
  recordDelivery(d: DeliveryRecord): void {
    this.deliveries.push(d)
  }
  recordCall(c: CallRecord): void {
    this.calls.push(c)
  }
}

export class MemoryAvatarStore implements AvatarStore {
  readonly files = new Map<string, Uint8Array>()
  async save(runId: string, participantId: string, png: Uint8Array): Promise<string> {
    const url = `/avatars/${runId}/${participantId}.png`
    this.files.set(url, png)
    return url
  }
}
