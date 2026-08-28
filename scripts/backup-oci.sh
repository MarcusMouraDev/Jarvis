#!/usr/bin/env bash
set -euo pipefail

: "${RESTIC_REPOSITORY:?set encrypted Restic repository}"
: "${RESTIC_PASSWORD_FILE:?set RESTIC_PASSWORD_FILE outside Git}"

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

paths=(
  "$data_root/data"
  "$data_root/hermes"
  "$data_root/omniroute"
  "$data_root/workspaces"
)
for source in "${paths[@]}"; do
  [[ -d "$source" ]] || { echo "missing backup source: $source" >&2; exit 2; }
done

compose=(docker compose --project-directory "$project_dir" --profile "$profile")
running=()
while IFS= read -r service; do
  [[ -n "$service" ]] && running+=("$service")
done < <("${compose[@]}" ps --services --filter status=running)

restore_test=""
cleanup() {
  status=$?
  trap - EXIT INT TERM
  if [[ -n "$restore_test" && "$restore_test" == "$data_root"/.restore-test.* ]]; then
    rm -rf -- "$restore_test"
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

export RESTIC_PASSWORD_FILE
restic snapshots --repo "$RESTIC_REPOSITORY" >/dev/null 2>&1 \
  || restic init --repo "$RESTIC_REPOSITORY"
restic backup "${paths[@]}" --repo "$RESTIC_REPOSITORY" --tag jarvis-stack
restic forget --repo "$RESTIC_REPOSITORY" --tag jarvis-stack \
  --keep-daily 7 --keep-weekly 4 --keep-monthly 6 --prune

restore_test="$(mktemp -d "$data_root/.restore-test.XXXXXX")"
restic restore latest --repo "$RESTIC_REPOSITORY" --tag jarvis-stack --target "$restore_test"
for source in "${paths[@]}"; do
  [[ -d "$restore_test$source" ]] \
    || { echo "restore verification missing: $source" >&2; exit 1; }
done
restic check --read-data-subset=1/20 --repo "$RESTIC_REPOSITORY"
