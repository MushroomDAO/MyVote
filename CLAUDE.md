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

No test runner is configured yet.

## Architecture

MyVote is a Vue 3 + TypeScript frontend for [Snapshot](https://snapshot.org) governance, built as a monorepo (`/apps/web`). It reads data from Snapshot's GraphQL API and submits votes via the Snapshot.js SDK.

### Layer overview

```
UI (Vue 3 pages + components)
  ├── ExplorePage  /explore           → lists DAO spaces (with Load More pagination)
  ├── SpacePage    /space/:id         → space details + proposals (with Load More)
  └── ProposalPage /proposal/:id      → proposal + Markdown body + vote results + voting form

State / Routing
  ├── router.ts                       → Vue Router (4 routes)
  ├── auth/useAuth.ts                 → reactive auth state, provider registration
  └── i18n.ts                         → vue-i18n (zh-CN default, EN fallback)

Branding / Theming
  ├── src/branding.ts                 → single file a community edits to customize (name, logo, colors)
  └── src/style.css                   → CSS custom properties (--mv-primary, --mv-border, etc.)
  └── src/main.ts                     → injects branding.colors as CSS vars + sets document.title

Auth providers (pluggable via AuthProvider interface)
  ├── walletProvider.ts               → EIP-1193 wallet (MetaMask etc.)
  └── airAccountProvider.ts           → Web2 login stub (Email, Google, WeChat…)

Data layer
  ├── lib/graphql.ts                  → GraphQL queries + TypeScript types (incl. scores/votes)
  └── config.ts                       → env-based endpoint config
```

### Data flow

1. Pages fetch data directly from Snapshot Hub GraphQL (`VITE_SNAPSHOT_GRAPHQL_ENDPOINT`).
2. Voting: ProposalPage uses `snapshot.js` to build + sign an EIP-712 message, then submits to `VITE_SNAPSHOT_HUB_URL`.
3. Auth state is provided globally via `useAuth()` composable; components call `connect(provider)` to swap providers.
4. Branding CSS variables are applied in `main.ts` before the app mounts.

### CSS variable system

All colors in components use `var(--mv-*)` custom properties. Brand colors (`--mv-primary`, `--mv-primary-hover`, `--mv-error`, `--mv-selected-bg`) are overridable via `branding.ts`. Structural neutral colors (`--mv-border`, `--mv-muted`, `--mv-surface`, etc.) are defined in `style.css`.

### Environment variables (`apps/web/src/config.ts`)

| Variable | Default |
|---|---|
| `VITE_SNAPSHOT_GRAPHQL_ENDPOINT` | `https://hub.snapshot.org/graphql` |
| `VITE_SNAPSHOT_HUB_URL` | `https://hub.snapshot.org` |
| `VITE_SNAPSHOT_APP_NAME` | `myvote` |

Copy `apps/web/.env.example` to `apps/web/.env.local` to override.

## Customizing for a new community (M1)

Edit only `apps/web/src/branding.ts`:
- `name`: shown in header and browser tab
- `logo`: path to image in `public/` (null = show name as text)
- `colors.primary` / `colors.primaryHover`: brand accent color
- `links`: optional footer links

See `docs/M1-clone-deploy.md` for full deployment instructions.

## Key design decisions

- **Classic Snapshot Hub** is the current backend (hub.snapshot.org). Snapshot X (Starknet on-chain) migration is planned for M3.
- **AirAccount** Web2 login is an adapter interface only — implementation is in progress.
- **SPA routing**: all routes fall back to `index.html`. `public/_redirects` handles this for Netlify/CF Pages. Vercel handles it automatically.
- Default locale is **zh-CN**; English is the fallback.
- Proposal bodies are rendered as **Markdown** (via `marked` + `dompurify`).

## Milestone docs

- `docs/M1-clone-deploy.md` — Clone & Deploy milestone (current)
- `docs/M2-multi-tenant.md` — Multi-tenant Cloudflare deployment plan
