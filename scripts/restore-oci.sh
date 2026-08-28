#!/usr/bin/env bash
set -euo pipefail

: "${RESTIC_REPOSITORY:?set encrypted Restic repository}"
: "${RESTIC_PASSWORD_FILE:?set RESTIC_PASSWORD_FILE outside Git}"
data_root="${JARVIS_DATA_ROOT:-/srv/jarvis}"
restore_root="$data_root/restore"
target="${1:-$restore_root/$(date -u +%Y%m%dT%H%M%SZ)}"
case "$data_root" in
  /*) ;;
  *) echo "JARVIS_DATA_ROOT must be absolute" >&2; exit 2 ;;
esac
case "$data_root" in
  /|/srv) echo "refusing unsafe JARVIS_DATA_ROOT: $data_root" >&2; exit 2 ;;
esac
case "$target" in
  "$restore_root"/*) ;;
  *) echo "restore target must be one directory under $restore_root" >&2; exit 2 ;;
esac
leaf="${target#"$restore_root"/}"
[[ -n "$leaf" && "$leaf" != */* && "$leaf" != "." && "$leaf" != ".." ]] \
  || { echo "restore target must be one directory under $restore_root" >&2; exit 2; }
if [[ -d "$target" ]] && find "$target" -mindepth 1 -print -quit | grep -q .; then
  echo "restore target is not empty: $target" >&2
  exit 2
fi
mkdir -p "$target"
export RESTIC_PASSWORD_FILE
restic check --read-data-subset=1/20 --repo "$RESTIC_REPOSITORY"
restic restore latest --repo "$RESTIC_REPOSITORY" --tag jarvis-stack --target "$target"
for source in data hermes omniroute workspaces; do
  [[ -d "$target$data_root/$source" ]] \
    || { echo "restore verification missing: $data_root/$source" >&2; exit 1; }
done
echo "Restore staged at $target; review before replacing live volumes."
