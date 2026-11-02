import { describe, expect, it } from 'vitest'
import { defaultConfig } from '@signal/config'
import { checkDialogue, fitLength, normalizeUtterance, similarity } from '../src'

const cfg = defaultConfig.validation
const base = { speakerName: '정하린', maxChars: 80, unknownNames: [] as string[], recentOwn: [] as string[] }

describe('normalizeUtterance', () => {
  it('strips the speaker’s own name tag and quotes', () => {
    expect(normalizeUtterance('하린: "안녕하세요"', '정하린')).toBe('안녕하세요')
    expect(normalizeUtterance('정하린: 반가워요\n잘 부탁해요', '정하린')).toBe('반가워요 잘 부탁해요')
  })
  it('keeps other people’s name tags so validation can reject them', () => {
    expect(normalizeUtterance('도현: 저도요', '정하린')).toBe('도현: 저도요')
  })
})

describe('checkDialogue', () => {
  it('accepts a normal line', () => {
    expect(checkDialogue({ ...base, text: '저도 그 영화 봤어요ㅋㅋ' }, cfg)).toEqual([])
  })
  it('rejects speaking for someone else', () => {
    expect(checkDialogue({ ...base, text: '도현: 저도요' }, cfg)).toContain('impersonation_line')
  })
  it('rejects PD impersonation and vote announcements', () => {
    expect(checkDialogue({ ...base, text: 'PD: 지금부터 투표 결과를 공개합니다' }, cfg)).toContain('system_impersonation')
    expect(checkDialogue({ ...base, text: '[공지] 모두 거실로 오세요' }, cfg)).toContain('system_impersonation')
  })
  it('rejects names the speaker cannot know (canary)', () => {
    expect(checkDialogue({ ...base, text: '민재씨는 언제 와요?', unknownNames: ['신민재'] }, cfg)).toContain('unknown_name')
  })
  it('rejects near-repetition of the speaker’s recent lines', () => {
    expect(checkDialogue({ ...base, text: '저는 커피 없으면 하루가 안 굴러가요', recentOwn: ['저는 커피 없으면 하루가 안 굴러가요!'] }, cfg)).toContain('repetition')
  })
  it('flags overly long lines', () => {
    expect(checkDialogue({ ...base, text: '가'.repeat(81) }, cfg)).toContain('too_long')
  })
})

describe('fitLength', () => {
  it('cuts at a sentence boundary when possible', () => {
    const text = '오늘 날씨 정말 좋네요. 다들 뭐 하면서 쉬세요? 저는 보통 산책하는데 오늘은 집에만 있었어요.'
    const out = fitLength(text, 30)
    expect(out).toBe('오늘 날씨 정말 좋네요. 다들 뭐 하면서 쉬세요?')
  })
  it('gives up when there is no reasonable boundary', () => {
    expect(fitLength('가'.repeat(100), 30)).toBeNull()
  })
})

describe('similarity', () => {
  it('is 1 for identical and low for unrelated lines', () => {
    expect(similarity('안녕하세요 반가워요', '안녕하세요 반가워요')).toBe(1)
    expect(similarity('안녕하세요 반가워요', '저는 러닝을 좋아해요')).toBeLessThan(0.2)
  })
})
