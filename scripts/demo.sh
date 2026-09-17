#!/usr/bin/env bash
#
# One command to run the demo.
#
#   pnpm demo
#
# Brings up the infrastructure, applies migrations, and starts the app. Safe to
# re-run: the containers are reused and migrations are idempotent.
set -euo pipefail

cd "$(dirname "$0")/.."

say() { printf '\n\033[1m%s\033[0m\n' "$1"; }
die() { printf '\n\033[31m%s\033[0m\n' "$1" >&2; exit 1; }

if ! command -v docker >/dev/null 2>&1; then
  die "Docker is required. Install Docker Desktop or OrbStack, then re-run."
fi
if ! docker info >/dev/null 2>&1; then
  die "Docker is installed but not running. Start it, then re-run."
fi

if [ ! -f .env ]; then
  say "No .env found — creating one from .env.example."
  cp .env.example .env
  die "Add your JEV_KEY to .env (a TypeSafe API key) and re-run. Everything else is pre-filled."
fi

if ! grep -qE '^JEV_KEY=.+' .env; then
  die "JEV_KEY is empty in .env. Add a TypeSafe API key and re-run."
fi

say "Starting Postgres and Redis"
docker compose up -d postgres redis >/dev/null

say "Waiting for Postgres"
for _ in $(seq 1 60); do
  if docker compose exec -T postgres pg_isready -U postgres -q >/dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 1
done
[ "${ready:-}" = "1" ] || die "Postgres did not become ready in time. Check: docker compose logs postgres"
echo "  ready"

say "Applying migrations"
pnpm --silent migrate

say "Starting the app"
cat <<'EOF'

  ─────────────────────────────────────────────────────────────
   Open http://localhost:3000

   Sign in with any email address. The six-digit code is
   printed in this terminal. Then click
   "Try it with sample data" to see the product work.

   Ctrl-C to stop.
  ─────────────────────────────────────────────────────────────

EOF

exec pnpm --silent dev
