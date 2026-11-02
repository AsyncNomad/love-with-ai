#!/usr/bin/env bash
# 빌드 도구: cmake, ninja(uv), CUDA 툴킷.
# 시스템에 nvcc가 있으면 그것을 쓰고, 없으면 micromamba로 리포 안(.tools/cuda)에 설치한다(sudo 불필요).
source "$(dirname "$0")/env.sh"

if ! command -v cmake >/dev/null || ! command -v ninja >/dev/null; then
  command -v uv >/dev/null || { echo "uv가 필요합니다: https://docs.astral.sh/uv/" >&2; exit 1; }
  log "cmake, ninja 설치 (uv tool)"
  uv tool install --quiet cmake || true
  uv tool install --quiet ninja || true
fi

if command -v nvcc >/dev/null; then
  log "시스템 nvcc 사용: $(command -v nvcc)"
  exit 0
fi

if [[ ! -x "$TOOLS/cuda/bin/nvcc" ]]; then
  MM="$TOOLS/micromamba"
  if [[ ! -x "$MM" ]]; then
    log "micromamba $MICROMAMBA_VERSION 내려받기"
    curl -fsSL -o "$MM" "https://github.com/mamba-org/micromamba-releases/releases/download/${MICROMAMBA_VERSION}/micromamba-linux-64"
    chmod +x "$MM"
  fi
  log "CUDA $CUDA_VERSION 툴킷 설치 → $TOOLS/cuda"
  MAMBA_ROOT_PREFIX="$TOOLS/mamba" "$MM" create -y -q -p "$TOOLS/cuda" -c conda-forge \
    "cuda-version=$CUDA_VERSION" cuda-nvcc cuda-cudart-dev libcublas-dev cuda-nvrtc-dev
fi
log "CUDA 준비 완료: $("$TOOLS/cuda/bin/nvcc" --version | tail -1)"
