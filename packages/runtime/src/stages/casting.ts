import type { CastParticipant, ImageConfig } from '@heart/shared'
import { castHuman, castParticipants, seedInt } from '@heart/engine'
import type { StageContext, StageHandler } from '../director'

/** 프로필 사진 프롬프트(design.md §8.3-2). LLM 없이 템플릿으로 조립한다. 항상 성인 나이를 넣는다. */
export function avatarPrompt(cast: CastParticipant, cfg: ImageConfig): string {
  const values: Record<string, string> = {
    age: String(cast.age),
    person: cast.gender === 'female' ? 'woman' : 'man',
    hair: cast.appearance.hair,
    outfit: cast.appearance.outfit,
    expression: cast.appearance.expression,
    background: cast.appearance.background,
    vibe: cast.appearance.vibe,
  }
  return cfg.promptTemplate.replace(/\{(\w+)\}/g, (_, key: string) => values[key] ?? '')
}

/**
 * 캐스팅(design.md §8): 구조 제약 → 인격 서술(LLM) → GPU 교대 → 프로필 사진 → LLM 복귀.
 * 사진이 실패해도 게임은 시작한다(D22).
 */
export const castingStage: StageHandler = {
  id: 'CASTING',
  async run(ctx: StageContext): Promise<void> {
    const { session, config, projector } = ctx
    const profile = session.state.human
    if (!profile) throw new Error('RUN_CREATED must precede casting')
    const human = castHuman(profile)
    const ais = castParticipants(
      {
        human: profile,
        originalOpposite: config.composition.originalOpposite,
        originalSame: config.composition.originalSame,
        catfishPerGender: config.composition.catfishPerGender,
        ageSpread: config.ageSpread,
        minAge: config.minAge,
      },
      config.pools,
      ctx.rng.fork('casting'),
    )
    for (const p of [human, ...ais]) {
      session.commit({ type: 'PARTICIPANT_CAST', payload: { participant: p }, visibility: { kind: 'participants', ids: [p.id] }, idempotencyKey: `cast:${p.id}` })
    }

    projector.setCasting({ phase: 'persona', done: 0, total: ais.length })
    const usedLines: string[] = []
    for (const [i, ai] of ais.entries()) {
      const { flavor, fallback } = await ctx.agents.castFlavor(ai, usedLines)
      usedLines.push(...flavor.exampleLines)
      session.commit({ type: 'PERSONA_FLAVORED', payload: { participantId: ai.id, flavor, fallback }, visibility: { kind: 'participants', ids: [ai.id] } })
      projector.setCasting({ phase: 'persona', done: i + 1, total: ais.length })
    }

    const image = ctx.image
    if (image) {
      projector.setCasting({ phase: 'images', done: 0, total: ais.length })
      await ctx.lease.use('image', async () => {
        for (const [i, ai] of ais.entries()) {
          const url = await image
            .generate({
              prompt: avatarPrompt(ai, config.image),
              seed: seedInt(session.state.seed, ai.id),
              width: config.image.width,
              height: config.image.height,
              steps: config.image.steps,
            })
            .then((png) => ctx.avatars.save(session.runId, ai.id, png))
            .catch(() => null)
          session.commit({ type: 'AVATAR_READY', payload: { participantId: ai.id, url }, visibility: { kind: 'server' } })
          projector.setCasting({ phase: 'images', done: i + 1, total: ais.length })
        }
      })
    }

    session.commit({ type: 'CASTING_COMPLETED', payload: {}, visibility: { kind: 'server' }, idempotencyKey: 'casting_completed' })
    projector.setCasting(null)
  },
}
