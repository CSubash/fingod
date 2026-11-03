#!/bin/sh
# Assemble what gets deployed to Cloudflare into .site/: the landing page at the root and the app,
# with its demo, under /app/. It copies an explicit list of paths, never the repo, so nothing from
# data/ (your real numbers) can ride along; the last lines refuse to continue if anything slips in.
set -eu
cd "$(dirname "$0")/.."
rm -rf .site
mkdir -p .site/app/landing
cp -R landing/. .site/
cp index.html .site/app/
cp -R src vendor .site/app/
cp landing/favicon.svg .site/app/landing/
if find .site -path '*/data/*' -o -name '*.env' -o -name 'wallet-*.json' -o -name 'tradebook-*' | grep -q .; then
  echo "refusing to deploy: .site contains something that looks like personal data" >&2
  exit 1
fi
echo "staged .site ($(find .site -type f | wc -l | tr -d ' ') files)"
