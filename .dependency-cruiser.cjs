/**
 * design.md §4.1 의존 방향:
 *   shared ← engine ← agents ← (inference, store) ← runtime ← apps/server
 *   shared ← apps/web
 * 테스트 파일은 검사하지 않는다(src만).
 */
const pkg = (name) => `^packages/${name}/src`
module.exports = {
  forbidden: [
    { name: 'shared-is-a-leaf', severity: 'error', from: { path: pkg('shared') }, to: { path: '^packages/(?!shared)|^apps/' } },
    { name: 'engine-is-pure', severity: 'error', from: { path: pkg('engine') }, to: { path: '^packages/(agents|inference|store|runtime|config)|^apps/|^node:|better-sqlite3|fastify' } },
    { name: 'agents-no-adapters', severity: 'error', from: { path: pkg('agents') }, to: { path: '^packages/(inference|store|runtime|config)|^apps/' } },
    { name: 'adapters-not-runtime', severity: 'error', from: { path: '^packages/(inference|store)/src' }, to: { path: '^packages/runtime|^apps/' } },
    { name: 'runtime-no-adapters', severity: 'error', from: { path: pkg('runtime') }, to: { path: '^packages/(inference|store|config)|^apps/' } },
    { name: 'web-only-shared', severity: 'error', from: { path: '^apps/web/src' }, to: { path: '^packages/(?!shared)|^apps/server' } },
    { name: 'no-circular', severity: 'error', from: {}, to: { circular: true } },
    { name: 'no-unresolvable', severity: 'error', comment: '선언하지 않은 패키지 import(pnpm에서는 풀리지 않는다)', from: {}, to: { couldNotResolve: true } },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    exclude: { path: '(^|/)(test|dist|node_modules)/' },
    tsPreCompilationDeps: true,
    combinedDependencies: true,
    enhancedResolveOptions: { exportsFields: ['exports'], conditionNames: ['import', 'default'], extensions: ['.ts', '.tsx', '.js'] },
  },
}
