#!/usr/bin/env bash
# Deploy a PREVIEW (non-production) build to Cloudflare Pages.
#
# Why this wrapper exists:
#   `wrangler pages deploy` mirrors the KV bindings declared in the wrangler.toml
#   of its working directory onto the Pages project, using `id`. The default
#   `wrangler.toml` declares the PRODUCTION namespace, so a plain
#   `wrangler pages deploy --branch dev` repoints the project's *preview*
#   binding at production data (observed 2026-09-24). This script instead runs
#   wrangler from a scratch directory whose wrangler.toml (copied from
#   `wrangler.preview.toml`) declares the preview namespace.
#
# Usage:
#   apps/web/scripts/deploy-preview.sh [branch]     # default branch: dev
#
# Production deploys are unchanged — run `wrangler pages deploy dist --project-name myvote --branch main`
# from apps/web, which uses wrangler.toml (production namespace).
set -euo pipefail

WEB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BRANCH="${1:-dev}"
PROJECT="${CF_PAGES_PROJECT:-myvote}"

cd "$WEB_DIR"

if [ ! -f wrangler.preview.toml ]; then
  echo "error: wrangler.preview.toml not found in $WEB_DIR" >&2
  exit 1
fi

echo "==> build"
if [ -x ./node_modules/.bin/vite ]; then
  ./node_modules/.bin/vite build
else
  npx -y vite build
fi

SCRATCH="$(mktemp -d)"
DEPLOY_LOG="$(mktemp)"
trap 'rm -rf "$SCRATCH" "$DEPLOY_LOG"' EXIT
cp wrangler.preview.toml "$SCRATCH/wrangler.toml"
ln -s "$WEB_DIR/functions" "$SCRATCH/functions"

echo "==> deploy branch '$BRANCH' with the PREVIEW KV namespace"
npx -y wrangler@4 pages deploy "$WEB_DIR/dist" \
  --project-name "$PROJECT" \
  --branch "$BRANCH" \
  --commit-dirty=true \
  --cwd "$SCRATCH" | tee "$DEPLOY_LOG"

# --- post-deploy smoke check -------------------------------------------------
# A deploy can report success while the branch alias serves a stale or empty
# project, so fetch the alias and require the app shell. Override the target
# with CF_PREVIEW_URL.
PREVIEW_URL="${CF_PREVIEW_URL:-}"
if [ -z "$PREVIEW_URL" ]; then
  # When no alias appears in the log (e.g. a wrangler log-format change), the
  # smoke check warns and skips; the deploy itself already succeeded.
  PREVIEW_URL="$(grep -oE 'https://[A-Za-z0-9.-]+\.pages\.dev' "$DEPLOY_LOG" | tail -1)" || PREVIEW_URL=""
fi
if [ -n "$PREVIEW_URL" ]; then
  echo "==> smoke check $PREVIEW_URL"
  if ! body="$(curl -fsS --max-time 20 "$PREVIEW_URL/")"; then
    echo "error: preview smoke check failed: cannot fetch $PREVIEW_URL" >&2
    exit 1
  fi
  if ! printf '%s' "$body" | grep -q 'id="app"'; then
    echo "error: preview smoke check failed: app shell marker missing at $PREVIEW_URL" >&2
    exit 1
  fi
  echo "    ok: HTTP 200 + app shell"
else
  echo "warning: could not determine the preview URL; skipping smoke check" >&2
fi
