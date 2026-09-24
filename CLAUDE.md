# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Dev server (accessible on local network)
cd apps/web && pnpm run dev -- --host 0.0.0.0 --port 5173
# or use the helper script at repo root:
./run.sh

# Production build (type-check + bundle)
cd apps/web && pnpm run build

# Preview production build
cd apps/web && pnpm run preview
```

Tests run with **Vitest** (`pnpm run test`, happy-dom). Unit tests sit next to the code as `*.test.ts` (`auth/`, `lib/`, `pages/`); **Cloudflare Functions are tested too** (`functions/**/*.test.ts`, run under Node via a per-file `@vitest-environment node` docblock). There is no lint script; `pnpm run build` runs `vue-tsc -b` (typecheck) before bundling.

```bash
cd apps/web && pnpm run test       # Vitest
cd apps/web && pnpm run typecheck  # vue-tsc only
```

> In a non-TTY shell `pnpm` may refuse to purge `node_modules`. Run the local binaries directly instead: `cd apps/web && ./node_modules/.bin/vitest run`.
> `apps/web/pnpm-workspace.yaml` declares `allowBuilds: esbuild` so pnpm 11 does not fail on ignored build scripts.

## Pre-PR Check

Before opening any PR, run the shared pre-pr-check (mechanical rules):

```bash
bash ~/Dev/tools/PR-daemon/scripts/pre-pr-check.sh --base <base>
```

- `--version` shows the rules version; `--selftest` runs the self-check
- Rules doc: `/Users/jason/Dev/tools/PR-Daemon/.claude/skills/pre-pr-rules/SKILL.md`
- Full workflow: see `docs/development-loop.md`

## Architecture

MyVote is a Vue 3 + TypeScript frontend for [Snapshot](https://snapshot.box) governance. Although the repo is described as a monorepo, `apps/web` is the only package (no root `package.json` / workspace). It reads data from the Snapshot **Hub GraphQL** API and submits **classic off-chain** votes via a hand-rolled EIP-712 envelope (`viem`), plus Cloudflare Pages Functions for multi-tenancy. `ethers` / `snapshot.js` were removed in the AirAccount work; the on-chain Snapshot X path is a planned *optional* backend — see `docs/snapshot-version-decision.md`.

### Layer overview

```
UI (Vue 3 pages, src/pages/)
  ├── ExplorePage     /explore          → lists DAO spaces (Load More + 5-min cache)
  ├── SpacePage       /space/:id        → space details + proposals (Load More)
  ├── ProposalPage    /proposal/:id     → proposal + Markdown body + results + voting form
  ├── RegisterPage    /register         → self-service subdomain registration
  └── SsoCallbackPage /sso/callback     → fixed cos72 SSO callback (consumes ?code=)

State / Routing
  ├── router.ts                         → Vue Router (6 entries; tenant-aware guard)
  ├── tenant.ts                         → merges window.__TENANT__ over branding.ts → resolvedBranding
  ├── auth/useAuth.ts                   → reactive auth state, provider registration
  └── i18n.ts                           → vue-i18n (zh-CN default, EN fallback)

Branding / Theming
  ├── src/branding.ts                   → single file a community edits (name, logo, colors, links)
  ├── src/style.css                     → structural CSS custom properties (--mv-border, --mv-muted, …)
  └── src/main.ts                       → injects resolvedBranding.colors as CSS vars + document.title

Auth providers (pluggable via AuthProvider interface, auth/types.ts)
  ├── walletProvider.ts                 → EIP-1193 wallet (MetaMask etc.)
  ├── airAccountProvider.ts             → AirAccount adapter surface
  ├── airAccountBridge.ts               → cos72 SSO session (OAuth code exchange) + remote signing
  └── kms.ts                            → KmsSigner seam; placeholder throws until E-5 ships

Data / vote layer
  ├── lib/graphql.ts                    → Hub GraphQL queries + types (spaces/proposals/votes/scores)
  ├── lib/snapshotVote.ts               → hand-built EIP-712 vote envelope + hub/sequencer submit
  ├── lib/voteBackend.ts                → off-chain vote-backend seam (VoteBackend)
  ├── lib/sx/backend.ts                 → Snapshot X EVM backend (lazy import of @snapshot-labs/sx)
  ├── lib/voteRouting.ts                → protocolForSpaceId: 0x… → SX, ENS → off-chain
  ├── lib/errors.ts                     → coded errors + locale resolution
  ├── lib/requestGuard.ts               → stale-response guard for loaders
  ├── lib/cache.ts                      → TTL in-memory cache (ExplorePage)
  └── config.ts                         → env-based endpoint config

Edge layer (Cloudflare Pages Functions, apps/web/functions/)
  ├── _middleware.ts                    → /api/graphql proxy + tenant KV lookup + __TENANT__ injection
  └── api/{check,register,status}.ts    → self-service subdomain registration (TENANTS_KV)
```

### Data flow

1. Pages fetch data from Snapshot Hub GraphQL (`VITE_SNAPSHOT_HUB` → `${hub}/graphql`, or the `/api/graphql` edge proxy for China connectivity).
2. Voting (`lib/snapshotVote.ts`): build + sign the EIP-712 vote envelope, then POST it to the Hub's sequencer. The wallet provider signs locally; the AirAccount provider signs remotely via `auth/kms.ts`.
3. Auth state is global via the `useAuth()` composable; components call `connect(provider)` to swap providers.
4. Multi-tenancy: the edge function resolves the hostname from KV and injects `window.__TENANT__`; `tenant.ts` merges it over `branding.ts` before `main.ts` applies CSS vars.

### CSS variable system

All colors in components use `var(--mv-*)` custom properties. Brand colors (`--mv-primary`, `--mv-primary-hover`, `--mv-error`, `--mv-selected-bg`) are overridable via `branding.ts`. Structural neutral colors (`--mv-border`, `--mv-muted`, `--mv-surface`, etc.) are defined in `style.css`.

### Environment variables (`apps/web/src/config.ts`)

| Variable | Default |
|---|---|
| `VITE_SNAPSHOT_HUB` | `https://testnet.hub.snapshot.org` (legacy alias: `VITE_SNAPSHOT_HUB_URL`) |
| `VITE_SNAPSHOT_GRAPHQL_ENDPOINT` | `${VITE_SNAPSHOT_HUB}/graphql` |
| `VITE_SNAPSHOT_APP_NAME` | `myvote` |
| `VITE_COS72_API` | *(empty)* — AirAccount SSO origin |
| `VITE_COS72_AUTHORIZE_URL` | `${VITE_COS72_API}/sso/start` |
| `VITE_SSO_CALLBACK_PATH` | `/sso/callback` |
| `VITE_SSO_ONLY` | `false` |

The default is the **testnet** hub because the target space lives on Sepolia, and a testnet space does not exist on the mainnet hub. Copy `apps/web/.env.example` to `apps/web/.env.local` to override.

## Customizing for a new community (M1)

Edit `apps/web/src/branding.ts` (single-community default) or a tenant's KV record (per-host override):
- `name`: shown in header and browser tab
- `logo`: path to image in `public/` (null = show name as text)
- `favicon`: favicon path
- `colors.primary` / `colors.primaryHover`: brand accent color
- `links`: optional footer links

Per-host overrides are injected by the edge function — see `docs/M2-multi-tenant.md`. Full clone & deploy steps: `docs/M1-clone-deploy.md`.

## Key design decisions

- **Classic off-chain Snapshot Hub** is the current default backend (`VITE_SNAPSHOT_HUB`, testnet by default). **Snapshot X is an optional future backend, not a replacement** — see `docs/snapshot-version-decision.md` and `docs/Plan.md`.
- **AirAccount** Web2 login: the cos72 SSO flow + `KmsSigner` seam are implemented, but the remote KMS signer (E-5) and cos72's SSO landing page are **not delivered yet**, so AirAccount signing throws in production.
- **Vote write path is hand-rolled** (`lib/snapshotVote.ts`, `viem`): `snapshot.js`'s `Client712` hardcodes ethers v5, which is why ethers/snapshot.js were dropped.
- **SPA routing**: all routes fall back to `index.html`. `public/_redirects` handles this for Netlify/CF Pages. Vercel handles it automatically.
- Default locale is **zh-CN**; English is the fallback. The **vote path** returns coded errors translated in the UI (`lib/errors.ts`); the auth/SSO layer still throws hardcoded Chinese in places — an open i18n gap.
- **Environments share one Pages project**: `main` → production KV, other branches → preview KV. Deploy previews with `apps/web/scripts/deploy-preview.sh` — a bare `wrangler pages deploy` repoints the preview binding at production data (see `docs/deployment.md` §2).
- Proposal bodies are rendered as **Markdown** (`marked` + `dompurify`).

## Milestone docs

- `docs/Plan.md` — current roadmap (M3–M6)
- `docs/snapshot-version-decision.md` — classic Snapshot vs new stack decision
- `docs/M1-clone-deploy.md` — Clone & Deploy milestone (done)
- `docs/M2-multi-tenant.md` — Multi-tenant implementation (done; KV + self-registration)
- `docs/SnapshotX.md` — historical Snapshot X research (partly outdated)
- `docs/architecture-review.md` — repository architecture review / tech debt
- `docs/development-loop.md` — dev loop + pre-PR check
- `docs/deployment.md` — deploy runbook (environments, KV namespaces, secrets)
