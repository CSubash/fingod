#!/bin/sh
# Stage the site, then deploy it. Needs Node for wrangler; pass --dry-run to only stage and check.
set -eu
cd "$(dirname "$0")/.."
sh scripts/stage-site.sh
[ "${1:-}" = "--dry-run" ] && exit 0
npx wrangler deploy
