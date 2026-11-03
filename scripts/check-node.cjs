// npm run dev/start/check 전에 Node 버전을 검사한다(package.json의 pre* 스크립트).
// 옛 Node에서도 돌아야 하므로 문법을 단순하게 둔다.
var major = Number(process.versions.node.split('.')[0])
if (major < 22) {
  console.error('')
  console.error('[하트 하우스] Node 22 이상이 필요합니다. 지금은 ' + process.version + ' (' + process.execPath + ') 입니다.')
  console.error('  해결: source ~/.nvm/nvm.sh && nvm use   (리포의 .nvmrc에 맞춰 Node 24로 바뀝니다)')
  console.error('  매번 하지 않으려면 ~/.bashrc에 nvm 초기화 줄을 추가하세요(README 참고).')
  console.error('')
  process.exit(1)
}
