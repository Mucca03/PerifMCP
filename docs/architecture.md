# Architecture

## Components

### `@perifmcp/core`

Portable TypeScript with no Node or DOM dependency:

- 64-key layout model (`layout.ts`)
- keyboard configuration types (`types.ts`)
- CRC-16/CCITT-FALSE and 64-byte packet codec (`protocol/`)
- LE profile container codec (`protocol/le.ts`)
- transport and client interfaces (`transport.ts`, `client.ts`)
- default configuration and helpers (`config.ts`)

### `apps/daemon`

Planned local service:

- HTTP/JSON API for the web UI
- MCP server over stdio for agents
- one shared `KeyboardService` that owns the device connection
- plans, previews, snapshots, apply and verify

### `apps/web`

Vite + React single-page UI:

- 64-key ANSI layout
- connection and model status
- layer selector (base, Fn1, Fn2, Fn3)
- key inspector and assignment editor
- macro editor
- per-key and effect lighting editor
- pending changes, apply, revert, backup and restore
- AI plan panel with a diff and confirmation

## Data flow

```text
Agent / UI
   │  semantic request
   ▼
KeyboardService
   │  validate → diff → plan
   ▼
Plan { changes, warnings, requiresConfirmation }
   │  user or agent confirms
   ▼
Snapshot → apply → verify
   │
   ▼
KeyboardConfig (shared state)
```

## Plan/apply contract

A plan is a pure description of intended changes. It must be serializable, inspectable and idempotent. Applying a plan must:

1. validate every key, layer, macro and color;
2. capture a snapshot;
3. write only the changed records;
4. read back and compare the result;
5. return a result with `applied` and `verified` flags.

## Phases

0. Read-only identification: udev, ping, firmware, model ID, device ID, matrix, vendor callbacks.
1. UI shell with mock data: 64-key keyboard, inspector, layer selector.
2. Key remapping and macros with apply/revert and snapshots.
3. Lighting effects, per-key colors, profiles and import/export.
4. Packaging as a desktop app (Tauri or similar).

## Security boundaries

- The web UI talks to `localhost` only.
- The daemon binds to `127.0.0.1`.
- No arbitrary file writes.
- No raw packet endpoint.
- No firmware route.
- Snapshots are stored under `profiles/local/` and are gitignored by default.
