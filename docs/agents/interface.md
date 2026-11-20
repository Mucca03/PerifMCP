# Brief: interface sub-agent

Zone: `apps/web/`. Do not edit anything else. Package name `@perifmcp/web`, scripts `dev`, `build`, `typecheck`, `test`.

Goal: a local web UI for the 64-key GIM K64 that works fully against a mock, and against the real daemon without code changes.

## Stack

Vite, React 19, TypeScript (strict, extends `tsconfig.base.json`), Tailwind CSS 4, Vitest. Dev server on `127.0.0.1:5173`. No Next.js, no analytics, no external fonts loaded from a CDN at runtime (bundle them or use the system mono stack).

## What you may import from `@perifmcp/core`

Types, `GIM_K64_LAYOUT`/`DEFAULT_LAYOUT`, `createDefaultConfig`, the contract types in `service.ts`, `api.ts` and `tools.ts`, and the pure helpers from `semantics.ts`/`keys.ts` once they exist. Never import `@perifmcp/core/protocol`, `client.ts`, `transport.ts` or `safety.ts`. The UI knows nothing about packets.

## API layer

`src/api/` exposes one `ApiClient` typed from `ApiRoutes` in `api.ts`. Two implementations behind the same interface:

- `HttpApiClient`: `fetch` to `VITE_DAEMON_URL` (default `http://127.0.0.1:6465`). JSON only. Errors arrive as `ApiErrorBody`. Map `error.code` to a visible message, never to a silent failure.
- `MockApiClient`: in memory, selected with `VITE_USE_MOCK=1` or when the daemon is unreachable at startup (show a "mock data" badge in that case).

The mock must obey the same rules as the real service (see `KeyboardService` doc comment in `service.ts`): plans are immutable, preview before apply, `confirm: true`, snapshot before apply, `plan-stale` when the config revision changed, `write-disabled` when `status.writeEnabled` is false. Use the core helpers (`applyChanges`, `diffConfig`) instead of rewriting that logic. Until they land, write a thin local stub with the same signature in `src/api/mock-semantics.ts` and delete it later.

No WebSocket or SSE. Poll `GET /api/status` and `GET /api/plans` every few seconds while the tab is visible.

## Screens and behavior

- Header: name, nav, connection state, model, access mode. In `read-only` mode show a persistent banner and disable every apply, restore and snapshot button, with the reasons from `status.writeDisabledReasons` as the tooltip or text. Planning and preview stay enabled.
- Keyboard: draw the 64 keys from `layout.keys` using `x`, `y`, `width`. Click or keyboard-focus selects a key. Show per-key color from the lighting state and from a pending plan.
- Layer selector: `base`, `fn1`, `fn2`, `fn3`.
- Key inspector and assignment editor: key, macro, layer switch, none. Codes come from `KEY_CODES`.
- Macro editor: ordered key/delay steps, repeat. Validate with `validateChange` before creating a plan. Do not offer macro recording (the contract says the agent cannot press keys, and the UI has no hook for it yet).
- Lighting editor: effect, color, brightness and speed (percent), zones, per-key colors.
- Pending changes: every edit becomes a plan via `POST /api/plans/*`. Show the diff from `GET /api/plans/:id/preview`, then an explicit confirm step before `apply`.
- Agent plans: list `GET /api/plans`. A plan created through MCP appears here with its diff and the same confirm button.
- Snapshots: list, create, restore (with confirm). After apply, show `applied` and `verified` separately. A verified `false` is shown as a warning with the mismatches.

## Look and feel (from `/home/mucca/code/muccaPortfolio2`)

Read `app/globals.css`, `app/layout.tsx`, `components/site-background.tsx`, `components/site-header.tsx`, `components/scramble-heading.tsx`, `components/theme-provider.tsx` and `lib/site-data.ts` for reference. Reproduce the visual language, not the content.

- Black page (`bg-black`), white text, monospace everywhere (Geist Mono or the system mono stack). `max-w-5xl` content column for text pages. The keyboard view may use the full width.
- One accent color in a CSS variable `--site-accent`, default `#86efac`, exposed as the Tailwind color `brand`. Theme list: green `#86efac`, purple `#c084fc`, blue `#93c5fd`, orange `#fdba74`, pink `#f9a8d4`. Cycle with a header button and with the `T` key when the focus is on `body`. Persist in `localStorage`.
- Background: fixed dot grid (22px, radial dots in the accent at 15% opacity, masked from the top) plus a large blurred accent glow at the top, with a slow color transition when the theme changes.
- Navigation as slash paths (`/keys`, `/macros`, `/lighting`, `/snapshots`). Active item in `text-brand`, others `text-gray-400` with `hover:text-brand`.
- Square corners and thin borders: `border border-gray-700`, `hover:border-brand hover:text-brand`. No rounded cards, no shadows.
- Headings use a short scramble animation on route change (about 800 ms) and must respect `prefers-reduced-motion`.
- Key caps: square, 1px border, accent on hover and selection. Lighting colors fill the cap at low opacity so the label stays readable (check contrast).
- Do not copy the owner's name, photo, social links, resume link or any asset from the portfolio.

## Accessibility and quality

- Everything reachable by keyboard, visible focus ring in the accent color, `aria-label` on icon buttons, `aria-live` for apply results.
- Colors are never the only signal (use text for state and errors).
- Tests: the keyboard renders 64 keys, apply is disabled when `writeEnabled` is false, the confirm step is required, mock `plan-stale` is surfaced.

## Done when

- `pnpm --filter @perifmcp/web dev` shows the full UI on the mock with no daemon.
- `pnpm typecheck` and `pnpm test` pass.
- The report lists any contract gap you hit (missing endpoint or field).
