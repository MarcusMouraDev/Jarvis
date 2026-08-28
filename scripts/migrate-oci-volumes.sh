#!/usr/bin/env bash
set -euo pipefail

data_root="${JARVIS_DATA_ROOT:-/srv/jarvis}"
project_dir="${JARVIS_COMPOSE_PROJECT_DIR:-$(cd "$(dirname "$0")/.." && pwd)}"
profile="${JARVIS_COMPOSE_PROFILE:-oci-a1-free}"
case "$data_root" in
  /*) ;;
  *) echo "JARVIS_DATA_ROOT must be absolute" >&2; exit 2 ;;
esac
case "$data_root" in
  /|/srv) echo "refusing unsafe JARVIS_DATA_ROOT: $data_root" >&2; exit 2 ;;
esac

mkdir -p "$data_root"
pairs=(
  "jarvis-data:data"
  "hermes-data:hermes"
  "omniroute-data:omniroute"
  "jarvis-workspaces:workspaces"
)
for pair in "${pairs[@]}"; do
  destination="$data_root/${pair#*:}"
  mkdir -p "$destination"
  if find "$destination" -mindepth 1 -print -quit | grep -q .; then
    echo "refusing non-empty migration target: $destination" >&2
    exit 2
  fi
done

compose=(docker compose --project-directory "$project_dir" --profile "$profile")
running=()
while IFS= read -r service; do
  [[ -n "$service" ]] && running+=("$service")
done < <("${compose[@]}" ps --services --filter status=running)

stage="$(mktemp -d "$data_root/.volume-migration.XXXXXX")"
cleanup() {
  status=$?
  trap - EXIT INT TERM
  if [[ -n "$stage" && "$stage" == "$data_root"/.volume-migration.* ]]; then
    sudo rm -rf -- "$stage"
  fi
  if ((${#running[@]})); then
    "${compose[@]}" start "${running[@]}"
  fi
  exit "$status"
}
trap cleanup EXIT INT TERM

if ((${#running[@]})); then
  "${compose[@]}" stop "${running[@]}"
fi

migrated=()
for pair in "${pairs[@]}"; do
  volume="${pair%%:*}"
  name="${pair#*:}"
  source="$(docker volume inspect --format '{{ .Mountpoint }}' "$volume" 2>/dev/null || true)"
  [[ -n "$source" ]] || continue
  case "$source" in
    /*) ;;
    *) echo "unsafe Docker volume mountpoint for $volume" >&2; exit 1 ;;
  esac
  destination="$stage/$name"
  mkdir -p "$destination"
  sudo tar -C "$source" -cf - . | sudo tar -C "$destination" -xpf -
  sudo diff -qr "$source" "$destination" >/dev/null
  migrated+=("$name")
done

for name in "${migrated[@]}"; do
  sudo rmdir "$data_root/$name"
  sudo mv "$stage/$name" "$data_root/$name"
done

echo "Migrated ${#migrated[@]} volume(s); Docker named volumes remain unchanged."
