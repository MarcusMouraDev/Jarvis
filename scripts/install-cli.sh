#!/usr/bin/env bash
# Instala o comando `jarvis` em ~/.local/bin (ativação: jarvis inti)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BIN="${HOME}/.local/bin"
TARGET="${BIN}/jarvis"

mkdir -p "$BIN"
ln -sf "${SCRIPT_DIR}/jarvis" "$TARGET"
chmod +x "${SCRIPT_DIR}/jarvis"

echo "→ ${TARGET}"
echo "Ative com: jarvis inti"
