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

# CUDA 커널 컴파일은 작업당 메모리를 많이 쓴다. 사용 가능 메모리 2GB당 1개로 제한한다.
if [[ -z "${JOBS:-}" ]]; then
  avail_gb=$(awk '/MemAvailable/ {print int($2/1024/1024)}' /proc/meminfo)
  JOBS=$(( avail_gb / 2 ))
  (( JOBS < 1 )) && JOBS=1
  (( JOBS > $(nproc) )) && JOBS=$(nproc)
fi

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
