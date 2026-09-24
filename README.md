# MyVote

[![License: Apache 2.0](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)

A white-label governance portal for any community. **Classic Snapshot (off-chain) by default, with optional on-chain [Snapshot X](https://docs.snapshot.box/snapshot-x/overview) support** through the same UI.

---

## What it does

- **Explore → Space → Proposal** pages, with results, Markdown proposal bodies and a voting form.
- **Two vote backends behind one seam:**
  - *Default* — classic off-chain Snapshot Hub: gasless EIP-712 signatures, fully interoperable with [snapshot.box](https://snapshot.box).
  - *Optional* — Snapshot X on-chain spaces (EVM, incl. **Optimism**): votes are signed and relayed gaslessly through Mana.
  - Routing is automatic: `0x…` spaces are on-chain, ENS names are off-chain (see `src/lib/voteRouting.ts`).
- **Pluggable login** via an `AuthProvider` interface:
  - `wallet` — any EIP-1193 wallet (MetaMask, …);
  - `airaccount` — cos72 SSO + remote KMS signing *(blocked on external services)*;
  - `email` — interim lightweight identity.
- **Multi-tenant white-label**: one deployment serves many communities, each on its own subdomain with its own branding (hostname → Cloudflare KV → `window.__TENANT__`).
- **zh-CN by default**, English fallback.
- **Cloudflare Pages Functions** at the edge for tenant resolution, self-service subdomain registration, and a `/api/graphql` proxy for connectivity.

> Design rationale for the classic-vs-new choice is recorded in [`docs/snapshot-version-decision.md`](./docs/snapshot-version-decision.md).

---

## Status

| Milestone | State |
|---|---|
| M1 Clone & Deploy (branding, pages, off-chain voting, i18n) | ✅ |
| M2 Multi-tenant (KV + edge injection + self-service registration) | ✅ |
| M3 Multi-backend write path, race guard, cache scoping, error i18n | ✅ |
| M4 AirAccount login | ⏸ MyVote side done (KMS signer + verified live signature); waiting on cos72 credentials — see `docs/cos72-airaccount-requirements.md` |
| M5 Snapshot X (EVM/OP): backend, read path, pages, results | ✅ (real Sepolia testnet vote cast 2026-09-24; public Mana has no Sepolia gas) |
| M5.5 Sepolia testnet community E2E: ENSv2 name → space → proposal → real votes | ✅ |
| M6 Registration hardening: rate limit, ownership proof, email code, atomic name claim (DO) | ✅ |

Full roadmap: [`docs/Plan.md`](./docs/Plan.md).

---

## Quick start

```bash
cd apps/web
pnpm install
pnpm run dev -- --host 0.0.0.0 --port 5173   # or: ./run.sh from the repo root
```

Open http://localhost:5173 — `/` redirects to `/explore`.

```bash
pnpm run build       # vue-tsc typecheck + vite build
pnpm run test        # Vitest (unit tests next to the code)
pnpm run typecheck
```

> If `pnpm` refuses to touch `node_modules` in a non-TTY shell, run the local binaries directly: `./node_modules/.bin/vitest run`.

### Try an on-chain space

On `/explore`, paste a Snapshot X space address into **Open an on-chain space** (e.g. the Optimism space `0x03C7431e14F7b759Aa44398AD7901e6053c197Bf`).

---

## Configuration

Copy `apps/web/.env.example` to `apps/web/.env.local` and override as needed.

| Variable | Default | Purpose |
|---|---|---|
| `VITE_SNAPSHOT_HUB` | `https://testnet.hub.snapshot.org` | Off-chain Hub (set to `https://hub.snapshot.org` for mainnet spaces) |
| `VITE_SNAPSHOT_GRAPHQL_ENDPOINT` | `${VITE_SNAPSHOT_HUB}/graphql` | Read endpoint (may point at the `/api/graphql` edge proxy) |
| `VITE_SNAPSHOT_APP_NAME` | `myvote` | App id sent with votes |
| `VITE_SX_API` | `https://api.snapshot.box` | Snapshot X indexer |
| `VITE_REGISTER_ROOT_DOMAIN` | `forest.mushroom.cv` | Root domain for community subdomains (must match the edge's `CF_ROOT_DOMAIN`) |
| `VITE_COS72_API` | *(empty)* | AirAccount SSO origin |
| `VITE_COS72_AUTHORIZE_URL` | `${VITE_COS72_API}/sso/start` | cos72 SSO start page |
| `VITE_SSO_CALLBACK_PATH` | `/sso/callback` | The one path cos72 may redirect back to |
| `VITE_SSO_ONLY` | `false` | AirAccount-only deployment |

The default is the **testnet** Hub because the space this repo targets lives on Sepolia; a testnet space does not exist on the mainnet hub.

### Branding a community

Edit [`apps/web/src/branding.ts`](./apps/web/src/branding.ts) (name, logo, colors, links) for a single deployment, or a tenant's KV record for per-host overrides.

---

## Deployment

Cloudflare Pages, one project, two environments:

- `main` → **production** (production KV);
- any other branch → **preview** (preview KV).

```bash
apps/web/scripts/deploy-preview.sh dev        # preview (uses the preview KV namespace)
```

> A bare `wrangler pages deploy --branch dev` repoints the project's *preview* KV binding at **production data**. Always use the script — full context in [`docs/deployment.md`](./docs/deployment.md).

---

## Architecture

Vue 3 + TypeScript + Vite, no state-management library. All backend access is external (Snapshot Hub GraphQL, the Snapshot X indexer, and Cloudflare Pages Functions). See [`CLAUDE.md`](./CLAUDE.md) for the layer map, data flow and key decisions.

Handy entry points:

- `src/lib/snapshotVote.ts` — hand-rolled off-chain EIP-712 vote envelope (no `snapshot.js`, no ethers).
- `src/lib/sx/` — Snapshot X backend (lazy-loaded SDK), read path and EIP-1193 provider adapter.
- `src/lib/errors.ts` — stable error codes translated in the UI.
- `functions/` — edge tenant resolution, registration, and the GraphQL proxy.

---

## Documentation

- [`docs/Plan.md`](./docs/Plan.md) — roadmap
- [`docs/snapshot-version-decision.md`](./docs/snapshot-version-decision.md) — classic vs new stack
- [`docs/snapshot-x-integration.md`](./docs/snapshot-x-integration.md) — Snapshot X (on-chain) integration guide
- [`docs/testnet-space-e2e.md`](./docs/testnet-space-e2e.md) — Sepolia testnet space end-to-end (ENSv2 quirks, reproducible steps)
- [`docs/sx-testnet.md`](./docs/sx-testnet.md) — Snapshot X testnet map + verified Sepolia on-chain vote
- [`docs/registration-atomicity.md`](./docs/registration-atomicity.md) — registration name claim via Durable Objects
- [`docs/cos72-airaccount-requirements.md`](./docs/cos72-airaccount-requirements.md) — interface requests for cos72 / AirAccount (M4)
- [`docs/deployment.md`](./docs/deployment.md) — environments, KV namespaces, secrets, runbook
- [`docs/M1-clone-deploy.md`](./docs/M1-clone-deploy.md) — clone & deploy for a new community
- [`docs/M2-multi-tenant.md`](./docs/M2-multi-tenant.md) — multi-tenancy
- [`docs/architecture-review.md`](./docs/architecture-review.md) — tech-debt review
- [`docs/development-loop.md`](./docs/development-loop.md) — dev loop & pre-PR check
- [`docs/check-list.md`](./docs/check-list.md) — step-by-step feature checklist for new staff
- [`docs/SnapshotX.md`](./docs/SnapshotX.md) — historical Snapshot X research (partly outdated)

---

## License

This project is licensed under the [Apache License, Version 2.0](LICENSE).
Copyright 2024-present MushroomDAO Contributors.
See [NOTICE](./NOTICE) · [TRADEMARK.md](./TRADEMARK.md) · [LICENSE-zh.md](./LICENSE-zh.md) · [TRADEMARK-zh.md](./TRADEMARK-zh.md) for details.
