#!/usr/bin/env bash
# 모델 파일을 내려받고 SHA-256으로 검증한다. 이미 있고 해시가 맞으면 건너뛴다.
# 사용: models.sh [llm|image|all]   (기본 all)
source "$(dirname "$0")/env.sh"
WHAT="${1:-all}"

# 이름|URL|SHA-256|용도
LLM_FILES=(
  "Qwen3.5-4B-Q4_K_M.gguf|https://huggingface.co/unsloth/Qwen3.5-4B-GGUF/resolve/main/Qwen3.5-4B-Q4_K_M.gguf|00fe7986ff5f6b463e62455821146049db6f9313603938a70800d1fb69ef11a4"
)
IMAGE_FILES=(
  # FLUX.2 [klein] 4B, Apache-2.0
  "flux-2-klein-4b-Q4_0.gguf|https://huggingface.co/leejet/FLUX.2-klein-4B-GGUF/resolve/main/flux-2-klein-4b-Q4_0.gguf|d1023499ef3f2f82ff7c50e6778495195c1b6cc34835741778868428111f9ff4"
  # 텍스트 인코더 Qwen3-4B
  "Qwen3-4B-Q4_K_M.gguf|https://huggingface.co/unsloth/Qwen3-4B-GGUF/resolve/main/Qwen3-4B-Q4_K_M.gguf|f6f851777709861056efcdad3af01da38b31223a3ba26e61a4f8bf3a2195813a"
  # VAE: FLUX.2 small decoder, Apache-2.0 (FLUX.2-dev의 ae는 접근 승인·비상업 라이선스라 쓰지 않는다)
  "flux2-small-decoder.safetensors|https://huggingface.co/black-forest-labs/FLUX.2-small-decoder/resolve/main/full_encoder_small_decoder.safetensors|ea4273f02d1fafbf8e1d1c2cf6018ed8748652eb0bf34f2dd91171f16f15ab62"
)

fetch() {
  local name="$1" url="$2" sha="$3" dest="$MODELS/$1"
  if [[ -f "$dest" ]] && echo "$sha  $dest" | sha256sum -c --status; then
    log "있음: $name"
    return
  fi
  log "내려받기: $name"
  curl -fL --retry 5 --retry-delay 3 -C - -A "love-with-ai-setup" -o "$dest.part" "$url"
  echo "$sha  $dest.part" | sha256sum -c --status || { echo "해시 불일치: $name" >&2; rm -f "$dest.part"; exit 1; }
  mv "$dest.part" "$dest"
}

files=()
[[ "$WHAT" == llm || "$WHAT" == all ]] && files+=("${LLM_FILES[@]}")
[[ "$WHAT" == image || "$WHAT" == all ]] && files+=("${IMAGE_FILES[@]}")
for entry in "${files[@]}"; do
  IFS='|' read -r name url sha <<<"$entry"
  fetch "$name" "$url" "$sha"
done
log "모델 준비 완료 ($MODELS)"
