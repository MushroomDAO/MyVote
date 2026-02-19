# MyVote feature checklist (step-by-step)

This checklist is for new staff to verify what is already implemented in the current repo.

## 0) Quick context

- App folder: `apps/web`
- Main pages:
  - Explore: `/explore`
  - Space detail: `/space/:id`
  - Proposal detail: `/proposal/:id`
- Docs:
  - `docs/Plan.md`
  - `docs/SnapshotX.md`

## 1) Prerequisites

- Node.js installed
- pnpm installed
- A browser wallet (e.g. MetaMask) to test voting

## 2) pnpm store (global)

Show global store-dir (if configured):

```bash
pnpm config get store-dir --global
```

Show the store path pnpm will use for the current shell:

```bash
pnpm store path
```

Notes:
- `pnpm config list` may print registry auth tokens. Do not paste it into chat/screenshots.

## 3) Install

From repo root:

```bash
cd apps/web
pnpm install
```

Expected:
- `pnpm-lock.yaml` exists in `apps/web`
- Install completes without errors

## 4) Run locally (dev)

```bash
cd apps/web
pnpm run dev -- --host 0.0.0.0 --port 5173
```

Open:
- http://localhost:5173/

Expected:
- `/` redirects to `/explore`
- Page renders without a blank screen

## 5) Config (optional)

The app reads these variables:
- `VITE_SNAPSHOT_GRAPHQL_ENDPOINT` (default: `https://hub.snapshot.org/graphql`)
- `VITE_SNAPSHOT_HUB_URL` (default: `https://hub.snapshot.org`)
- `VITE_SNAPSHOT_APP_NAME` (default: `myvote`)

Verification steps:
- Start with defaults (no env vars) and confirm Explore loads.
- Set a custom GraphQL endpoint and confirm Explore reflects the new backend.

## 6) i18n checks

Default language:
- Open in a fresh browser profile (no localStorage).
- Expected: Chinese (zh-CN) UI labels by default.

Language switch:
- Switch language to English in header.
- Expected: Labels change immediately.
- Refresh page.
- Expected: Language persists.

## 7) Auth provider switch (UI)

Header provider dropdown:
- Switch between `Wallet` and `AirAccount`.
- Expected: switching provider does not crash the app.

Wallet connect:
- Select `Wallet`, click Connect.
- Expected: wallet popup appears, after approval header shows short address.
- Click again to Disconnect.
- Expected: address clears.

AirAccount placeholder:
- Select `AirAccount`, click Connect.
- Expected: shows an error like “AirAccount adapter not configured”.
- This is expected until a Web2 binding adapter is wired.

## 8) Explore page (spaces)

Open `/explore`.

Expected:
- List of spaces loads.
- Clicking a space navigates to Space detail page.

Negative test:
- Temporarily set an invalid `VITE_SNAPSHOT_GRAPHQL_ENDPOINT`.
- Expected: error state appears and the app does not crash.

## 9) Space detail page (space + proposals)

From Explore, open a space.

Expected:
- Space name + id render.
- Proposals list renders (or shows “No data”).
- Clicking a proposal navigates to Proposal detail page.

Negative test:
- Open `/space/not-a-real-space`.
- Expected: handled empty/error state (no white screen).

## 10) Proposal detail page (proposal + voting)

From a space, open a proposal.

Expected (read-only):
- Title, state, author (short), start/end timestamps, body (if any)
- Choices list

Vote UI validation:
- Click “Submit vote” without selecting a choice.
- Expected: shows validation message (choose an option).

Vote submission (Snapshot Hub EIP-712):
- Connect wallet.
- Select a choice.
- Optionally input reason.
- Click “Submit vote” and approve the signature request.
- Expected: shows “Vote submitted”.

Optional external verification:
- Open the same proposal on Snapshot and confirm your vote appears (indexing may take some time).

## 11) Production build (typecheck + build)

```bash
cd apps/web
pnpm run build
```

Expected:
- Command succeeds with exit code 0

## 12) Known limitations (current state)

- AirAccount is an adapter interface only; Web2 binding is not implemented yet.
- Data layer currently uses Snapshot Hub GraphQL; Snapshot X `sx-api` alignment is not completed yet.
