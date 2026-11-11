#!/usr/bin/env bash
# Updates and (re)starts Knab on a Linux server.
#
#   ./deploy.sh            deploy the "main" branch
#   ./deploy.sh staging    deploy another branch
#
# Steps: back up the database, pull from GitHub, install dependencies, run the
# tests, build the web app, drop dev dependencies, reload the PM2 service and
# check that it answers. Any failing step stops the script before the running
# service is touched.
set -euo pipefail

say() { printf '\n==> %s\n' "$1"; }
die() { printf '\nERROR: %s\n' "$1" >&2; exit 1; }

# Everything runs inside main() so bash reads the whole file before git pull
# can replace it.
main() {
cd "$(dirname "$(readlink -f "$0")")"
BRANCH="${1:-main}"

command -v git >/dev/null || die "git is not installed."
command -v node >/dev/null || die "Node.js is not installed (version 22 or newer is required)."
command -v pm2 >/dev/null || die "PM2 is not installed. Run: npm install -g pm2"
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[ "$NODE_MAJOR" -ge 22 ] || die "Node.js 22 or newer is required (found $(node -v))."

if [ ! -f .env ]; then
  cp .env.example .env
  say "Created .env from .env.example - review it, then run this script again if you change anything."
fi

if [ -d node_modules/better-sqlite3 ]; then
  say "Backing up the database"
  node scripts/backup.js
fi

say "Pulling $BRANCH from GitHub"
[ -z "$(git status --porcelain --untracked-files=no)" ] || die "There are uncommitted changes in this folder. Commit or discard them first."
git fetch --prune origin
git checkout "$BRANCH"
git pull --ff-only origin "$BRANCH"

say "Installing dependencies"
npm ci

say "Running tests"
npm test

say "Building the web app"
# Build into a separate folder and swap it in, so a failed build leaves the
# live files untouched.
rm -rf dist.new
npx vite build --outDir ../dist.new --emptyOutDir
rm -rf dist.old
[ -d dist ] && mv dist dist.old
mv dist.new dist
rm -rf dist.old

say "Removing development dependencies"
npm prune --omit=dev

say "Restarting the service"
pm2 startOrReload ecosystem.config.cjs --update-env
pm2 save

say "Checking that the service answers"
PORT="$(grep -E '^PORT=' .env | tail -1 | cut -d= -f2 || true)"
PORT="${PORT:-3000}"
for attempt in 1 2 3 4 5 6 7 8 9 10; do
  if node -e "fetch('http://127.0.0.1:$PORT/api/v1/status').then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))"; then
    say "Knab is running on port $PORT (commit $(git rev-parse --short HEAD))."
    exit 0
  fi
  sleep 1
done
die "The service did not answer on port $PORT. Check: pm2 logs knab"
}

main "$@"
