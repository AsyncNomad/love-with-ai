/**
 * 시드 기반 난수(D15). 모듈마다 `fork(label)`로 독립 스트림을 쓰면, 한 곳에서 난수 호출이
 * 늘어나도 다른 곳의 결과가 바뀌지 않는다.
 */
export interface Rng {
  next(): number
  int(min: number, max: number): number
  chance(p: number): boolean
  pick<T>(items: readonly T[]): T
  shuffle<T>(items: readonly T[]): T[]
  weighted<T>(items: readonly T[], weight: (item: T) => number): T
  fork(label: string): Rng
}

function cyrb128(str: string): [number, number, number, number] {
  let h1 = 1779033703
  let h2 = 3144134277
  let h3 = 1013904242
  let h4 = 2773480762
  for (let i = 0; i < str.length; i++) {
    const k = str.charCodeAt(i)
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067)
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233)
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213)
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179)
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067)
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233)
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213)
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179)
  return [(h1 ^ h2 ^ h3 ^ h4) >>> 0, (h2 ^ h1) >>> 0, (h3 ^ h1) >>> 0, (h4 ^ h1) >>> 0]
}

function sfc32(a: number, b: number, c: number, d: number): () => number {
  return () => {
    a >>>= 0
    b >>>= 0
    c >>>= 0
    d >>>= 0
    let t = (a + b) | 0
    a = b ^ (b >>> 9)
    b = (c + (c << 3)) | 0
    c = (c << 21) | (c >>> 11)
    d = (d + 1) | 0
    t = (t + d) | 0
    c = (c + t) | 0
    return (t >>> 0) / 4294967296
  }
}

export function createRng(seed: string): Rng {
  const [a, b, c, d] = cyrb128(seed)
  const next = sfc32(a, b, c, d)
  for (let i = 0; i < 12; i++) next()

  const rng: Rng = {
    next,
    int(min, max) {
      return min + Math.floor(next() * (max - min + 1))
    },
    chance(p) {
      return next() < p
    },
    pick(items) {
      if (items.length === 0) throw new Error('rng.pick: empty list')
      return items[Math.floor(next() * items.length)] as (typeof items)[number]
    },
    shuffle(items) {
      const out = [...items]
      for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1))
        const tmp = out[i] as (typeof out)[number]
        out[i] = out[j] as (typeof out)[number]
        out[j] = tmp
      }
      return out
    },
    weighted(items, weight) {
      if (items.length === 0) throw new Error('rng.weighted: empty list')
      const weights = items.map((it) => Math.max(0, weight(it)))
      const total = weights.reduce((s, w) => s + w, 0)
      if (total <= 0) return rng.pick(items)
      let r = next() * total
      for (let i = 0; i < items.length; i++) {
        r -= weights[i] as number
        if (r <= 0) return items[i] as (typeof items)[number]
      }
      return items[items.length - 1] as (typeof items)[number]
    },
    fork(label) {
      return createRng(`${seed}/${label}`)
    },
  }
  return rng
}

/** 32비트 정수 시드(이미지 생성 등 외부 도구용). */
export function seedInt(...parts: string[]): number {
  return cyrb128(parts.join('/'))[0]
}
