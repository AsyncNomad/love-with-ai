# shellcheck shell=bash
# 로컬 추론 환경 공통 설정(design.md D3, D22, D27). 다른 스크립트가 source 한다.
# 모든 산출물은 리포 안의 git 무시 디렉터리에 둔다: .tools/ vendor/ bin/ models/
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TOOLS="$ROOT/.tools"
VENDOR="$ROOT/vendor"
BIN="$ROOT/bin"
MODELS="$ROOT/models"

# 버전 고정. 올릴 때는 docs/status.md의 검증을 다시 한다.
LLAMA_CPP_REF="v0.8.0"
SD_CPP_REF="master-1039-290148d"
CUDA_VERSION="12.9"
MICROMAMBA_VERSION="2.10.0-0"

# 75 = RTX 20/GTX 16, 86 = RTX 30(최소 사양 RTX 3060 Ti), 89 = RTX 40
CUDA_ARCHS="${CUDA_ARCHS:-75;86;89}"

# 빌드는 메모리 상한이 있는 별도 cgroup(systemd user scope)에서 돌린다(docs/status.md "WSL이 꺼지는 문제").
# WSL(systemd=true)에서는 Windows에서 띄운 프로세스(VS Code, 터미널, 에이전트)가 모두 init.scope에 있고,
# init.scope는 OOMPolicy=stop이다. 그 안에서 OOM 킬이 한 번만 나도 systemd가 세션 전체를 죽여 WSL이 꺼진 것처럼 보인다.
# 기본 상한은 전체 메모리의 60%다. MEM_LIMIT_MB로 바꿀 수 있다.
MEM_LIMIT_MB="${MEM_LIMIT_MB:-$(awk '/MemTotal/ {print int($2/1024*0.6)}' /proc/meminfo)}"

# CUDA 템플릿 인스턴스(flash attention, mmq) 하나를 컴파일할 때 cicc가 최대 약 6GB를 쓴다(실측 5.8GB).
# 상한 안에서 작업당 6GB로 병렬 수를 정한다.
if [[ -z "${JOBS:-}" ]]; then
  JOBS=$(( MEM_LIMIT_MB / 6144 ))
  (( JOBS < 1 )) && JOBS=1
  (( JOBS > $(nproc) )) && JOBS=$(nproc)
fi

# 무거운 명령을 메모리 상한 cgroup 안에서 실행한다. 상한을 넘으면 그 안의 프로세스만 죽고 세션은 살아남는다.
# user systemd가 없으면(일반 리눅스, 컨테이너) 그냥 실행한다.
capped() {
  if systemd-run --user --scope -q true 2>/dev/null; then
    systemd-run --user --scope -q -p "MemoryMax=${MEM_LIMIT_MB}M" -p OOMPolicy=continue -- "$@"
  else
    "$@"
  fi
}

mkdir -p "$TOOLS" "$VENDOR" "$BIN" "$MODELS"

log() { printf '\033[1;35m[setup]\033[0m %s\n' "$*"; }

# CUDA 툴킷 경로를 PATH에 올린다(toolchain.sh가 만든 것 또는 시스템 것).
use_cuda() {
  if [[ -x "$TOOLS/cuda/bin/nvcc" ]]; then
    export CUDA_HOME="$TOOLS/cuda"
    export PATH="$CUDA_HOME/bin:$PATH"
    export CUDACXX="$CUDA_HOME/bin/nvcc"
    export LD_LIBRARY_PATH="$CUDA_HOME/lib:${LD_LIBRARY_PATH:-}"
  fi
  export PATH="$HOME/.local/bin:$PATH"
  command -v nvcc >/dev/null || { echo "nvcc가 없습니다. scripts/setup/toolchain.sh 를 먼저 실행하세요." >&2; exit 1; }
}
