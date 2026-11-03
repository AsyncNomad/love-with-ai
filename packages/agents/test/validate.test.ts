import { describe, expect, it } from 'vitest'
import { defaultConfig } from '@heart/config'
import { checkDialogue, fitLength, hasForeignScript, isCasual, isPolite, isRepeat, limitLaughter, normalizeUtterance, similarity } from '../src'

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

describe('script and politeness checks (from real-model output)', () => {
  it('flags Chinese characters and kana leaking into Korean', () => {
    expect(hasForeignScript('쉬는 날 필라테스课上하고 와인 한 잔')).toBe(true)
    expect(hasForeignScript('こんにちは 반가워요')).toBe(true)
    expect(hasForeignScript('저는 Jay라고 해요 ㅋㅋ')).toBe(false)
    expect(checkDialogue({ ...base, text: '상대방을 逗引하는 스타일' }, cfg)).toContain('foreign_script')
  })
  it('tells polite endings from casual ones', () => {
    expect(isPolite('안녕하세요!')).toBe(true)
    expect(isPolite('저도 그 영화 봤어요ㅋㅋ')).toBe(true)
    expect(isPolite('반갑습니다.')).toBe(true)
    expect(isPolite('안녕! 처음 봐서 반갑다 ㅋㅋ')).toBe(false)
    expect(isPolite('쉬는 날 필라테스하고 사진 찍는 거야.')).toBe(false)
  })
})

describe('speech level (D13)', () => {
  it('rejects clearly casual endings only when everyone present is still polite', () => {
    expect(isCasual('안녕! 처음 봐서 반갑다 ㅋㅋ')).toBe(true)
    expect(isCasual('박수아라고 불러.')).toBe(true)
    expect(isCasual('오늘 하루 잘 보내자!')).toBe(true)
    expect(isCasual('ㅋㅋㅋ')).toBe(false)
    expect(isCasual('오 진짜')).toBe(false)
    expect(isCasual('반가워요! 잘 부탁드려요')).toBe(false)
    expect(isCasual('이름만 알면 돼. ㅋㅋ')).toBe(true)
    expect(isCasual('시은, 너랑 같이 할까? ㅋㅋ')).toBe(true)
    expect(isCasual('저도 좋아해요. ㅋㅋ')).toBe(false)
    expect(checkDialogue({ ...base, text: '처음 봐서 반갑다', mustBePolite: true }, cfg)).toContain('speech_level')
    expect(checkDialogue({ ...base, text: '처음 봐서 반갑다', mustBePolite: false }, cfg)).not.toContain('speech_level')
  })
})

describe('laughter and repetition (from real-model play)', () => {
  it('strips laughter for low-laughter personas and keeps at most one otherwise', () => {
    expect(limitLaughter('잠깐, 분위기가 정적이라서 ㅋㅋ. 커피 드셨어요? ㅋㅋㅋ', 0.2)).toBe('잠깐, 분위기가 정적이라서. 커피 드셨어요?')
    expect(limitLaughter('ㅋㅋㅋㅋ 저도요 ㅎㅎ 진짜요', 0.9)).toBe('ㅋㅋ 저도요 진짜요')
    expect(limitLaughter('ㅋㅋㅋ', 0.1)).toBe('')
  })
  it('treats a near-copy with an extra sentence as a repeat', () => {
    const a = '아, 커피 안 먹셨나요? 저는 오늘 아침에 커피 한 잔 마시면서 영상 편집을 하다가 잠깐 쉬었어요'
    const b = '아, 커피 안 마셨네요. 저는 오늘 아침에 커피 한 잔 마시면서 영상 편집을 하다가 잠깐 쉬었어요 혹시 뭐가 좋으신가요? 오늘 분위기 좀 바꿀 수 있는 거 있을까요?'
    expect(isRepeat(a, b, 0.7)).toBe(true)
    expect(isRepeat('네 좋아요', '네 좋네요', 0.7)).toBe(false)
  })
})
