#!/usr/bin/env bash
set -euo pipefail

stack_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$stack_dir"

yes=false
keep_data=false
wipe_sandboxed_only=false
no_cache=true

usage() {
  cat <<'EOF'
Usage: ./scripts/nuke-and-rebuild.sh [--yes] [--keep-data] [--cache]

Stops the Phantom Stack, wipes persisted orchestrator state, and forces a clean rebuild.

Default behavior:
- docker compose down -v --remove-orphans (wipes all volumes for this project)
- docker compose build --no-cache
- docker compose up -d --force-recreate

Flags:
  --yes        Skip confirmation prompt
  --keep-data  Do NOT delete any volumes (still rebuilds images)
  --wipe-sandboxed-only  Delete only the `sandboxed_data` volume
  --cache      Allow Docker build cache (not recommended for GLIBC/sqlite3 issues)
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --yes) yes=true; shift ;;
    --keep-data) keep_data=true; shift ;;
    --wipe-sandboxed-only) wipe_sandboxed_only=true; shift ;;
    --cache) no_cache=false; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown arg: $1" >&2; usage; exit 2 ;;
  esac
done

if ! command -v docker >/dev/null 2>&1; then
  echo "docker is required" >&2
  exit 1
fi

if [[ "$yes" != "true" ]]; then
  echo "This will stop the stack and (by default) delete ALL compose volumes for this project."
  echo "Continue? [y/N]"
  read -r ans
  if [[ "${ans,,}" != "y" && "${ans,,}" != "yes" ]]; then
    echo "Aborted."
    exit 1
  fi
fi

if [[ "$keep_data" == "true" ]]; then
  echo "[nuke] docker compose down (keeping volumes)"
  docker compose down --remove-orphans || true
elif [[ "$wipe_sandboxed_only" == "true" ]]; then
  echo "[nuke] docker compose down (keeping most volumes)"
  docker compose down --remove-orphans || true

  # Best-effort resolve the actual volume name for `sandboxed_data` (usually <project>_sandboxed_data).
  vol="$(
    docker volume ls --format '{{.Name}}' 2>/dev/null \
      | awk '$1 ~ /(^|_)sandboxed_data$/ {print $1}' \
      | head -n1 \
      || true
  )"
  if [[ -n "$vol" ]]; then
    echo "[nuke] removing volume: $vol"
    docker volume rm -f "$vol" || true
  else
    echo "[nuke] WARNING: could not resolve sandboxed_data volume name; skipping volume delete"
  fi
else
  echo "[nuke] docker compose down -v (wiping volumes)"
  docker compose down -v --remove-orphans || true
fi

build_args=()
if [[ "$no_cache" == "true" ]]; then
  build_args+=(--no-cache)
fi

echo "[nuke] docker compose build ${build_args[*]:-}"
docker compose build "${build_args[@]}"

echo "[nuke] docker compose up -d --force-recreate"
docker compose up -d --force-recreate

echo "[nuke] done"
