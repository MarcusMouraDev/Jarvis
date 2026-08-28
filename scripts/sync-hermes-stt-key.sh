#!/usr/bin/env bash
# Copy Jarvis Whisper/Groq key into the Hermes profile without printing it.
set -euo pipefail
JARVIS_ENV="${1:-$(cd "$(dirname "$0")/.." && pwd)/.env.local}"
PROFILE_ENV="${HERMES_HOME:-$HOME/.hermes/profiles/jarvis}/.env"
umask 077
mkdir -p "$(dirname "$PROFILE_ENV")"
touch "$PROFILE_ENV"
python3 - "$JARVIS_ENV" "$PROFILE_ENV" <<'PY'
from pathlib import Path
import sys
src, dest = Path(sys.argv[1]), Path(sys.argv[2])
whisper = None
for line in src.read_text().splitlines():
    if line.startswith("WHISPER_API_KEY=") or line.startswith("GROQ_API_KEY="):
        value = line.split("=", 1)[1].strip().strip('"')
        if value:
            whisper = value
            break
if not whisper:
    raise SystemExit("missing_whisper_key")
body = dest.read_text() if dest.exists() else ""
lines = [line for line in body.splitlines() if not line.startswith("GROQ_API_KEY=")]
lines.append(f"GROQ_API_KEY={whisper}")
dest.write_text("\n".join(lines) + "\n")
print("profile groq key synced")
PY
