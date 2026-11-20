---
name: perifmcp
description: Configure a GK6X/Semitek keyboard (GIM K64 / SK64 RGB) through the PerifMCP daemon's semantic MCP tools — per-key lighting, key remaps and macros, with snapshot/restore. Use when asked to change keyboard lighting, remap keys, record macros, or inspect keyboard state via the perifmcp MCP server.
---

# PerifMCP keyboard skill

Configure a GK6X/Semitek keyboard through the PerifMCP daemon using semantic MCP tools. You never build raw 64-byte HID packets; you call `keyboard_*` tools (or the equivalent HTTP API).

The tool names, schemas and behaviors below were verified live against a real **SK64 RGB** (`1ea7:0907`) in `read-write` mode.

## Golden rules

1. **Call `keyboard_status` first.** It reports `connection`, `mode` (`read-only` or `read-write`), `writeEnabled`, `writeDisabledReasons`, the device and the `configRevision`. If `mode` is `read-only`, do not attempt writes; report why from `writeDisabledReasons`.
2. **Snapshot before any write.** Call `keyboard_snapshot` and keep the returned `id`. Apply and restore *also* auto-create a safety snapshot, but take your own baseline so you can return the keyboard to where it started.
3. **Plan → preview → apply.** Create a plan, read the preview/diff, then apply with `confirm: true`. Never apply blind.
4. **Verification is weak by hardware design.** This keyboard has **no read-back command**. `apply` returns `verified: false` and `keyboard_verify` returns `ok: false` with a single `device` mismatch saying the result cannot be read back. This is normal, not a failure. The daemon confirms CRC acknowledgement of every packet; visual confirmation on the keyboard is the only true check.
5. **Restore to clean up.** After a temporary test, call `keyboard_restore` with the baseline `snapshotId` and `confirm: true`.
6. Never remap in a way that locks out the user (e.g. mapping every modifier to `none`). Never touch firmware or vendor VID; those tools do not exist here, by design.

## The tools

| Tool | Writes? | Input |
|---|---|---|
| `keyboard_status` | no | `{}` |
| `keyboard_get_layout` | no | `{}` |
| `keyboard_get_config` | no | `{ layer? }` |
| `keyboard_get_macros` | no | `{}` |
| `keyboard_get_lighting` | no | `{}` |
| `keyboard_plan_keys` | no (creates a plan) | see below |
| `keyboard_plan_macro` | no (creates a plan) | see below |
| `keyboard_plan_lighting` | no (creates a plan) | see below |
| `keyboard_preview_plan` | no | `{ planId }` |
| `keyboard_apply_plan` | **yes** | `{ planId, confirm: true }` |
| `keyboard_snapshot` | no (saves state) | `{ reason? }` |
| `keyboard_list_snapshots` | no | `{}` |
| `keyboard_restore` | **yes** | `{ snapshotId, confirm: true }` |
| `keyboard_verify` | no | `{}` |

Over HTTP the same actions are: `POST /api/plans/{keys,macro,lighting}`, `GET /api/plans/:id/preview`, `POST /api/plans/:id/apply`, `POST /api/snapshots`, `POST /api/snapshots/:id/restore`, `POST /api/verify`. Browser calls need a matching `Origin` header (default allowed: `http://127.0.0.1:5173`).

## Vocabulary (verified)

- **Layers:** `base`, `fn1`, `fn2`, `fn3`.
- **Key ids (64):** `escape digit1..digit0 minus equal backspace tab q w e r t y u i o p bracketleft bracketright backslash capslock a s d f g h j k l semicolon quote enter lshift z x c v b n m comma period slash rshift arrowup delete lctrl lwin lalt space fn menu arrowleft arrowdown arrowright`. These are the ids used in both plans and lighting.
- **Key codes** (for `assignment.code` / macro step `code`): HID usage names like `a`, `digit2`, `enter`, `space`, plus modifiers and consumer keys, plus `fn` and `disabled`. A code is not the same as a key id for symbols: to produce `@` on a US layout, use `code: "digit2"` with `modifiers: ["shift"]`.
- **Modifiers:** `ctrl shift alt gui altgr` (max 4 per assignment).
- **Lighting effects:** `off solid breathing rainbow wave reactive per-key`.
- **Lighting zones:** `wasd alphanumeric top-row arrows modifiers`.
- **Colors:** `#rrggbb` lowercase or uppercase hex; the leading `#` is required.

## Schemas (exact)

### keyboard_plan_lighting
```jsonc
{
  "effect": "per-key",              // optional, one of LIGHTING_EFFECTS
  "base": "#000000",                // optional, fills all keys first
  "perKey": { "w": "#86efac" },     // optional, per key id; overrides base
  "zones": { "wasd": "#86efac" },   // optional, per zone
  "color": "#800080",               // optional, for solid/breathing
  "brightness": 100,                // optional, int 0..100
  "speed": 50,                      // optional, int 0..100
  "direction": 0                    // optional, int 0..255
}
```
A `per-key` plan expands `base` across all 64 keys and overlays `perKey`, so the preview diff lists every key. That is expected.

### keyboard_plan_keys
```jsonc
{
  "layer": "base",
  "assignments": {                  // at least one entry required
    "menu": { "kind": "key", "code": "digit2", "modifiers": ["shift"] }
  }
}
```
Assignment kinds: `{ "kind": "key", "code", "modifiers"? }`, `{ "kind": "macro", "macroId" }`, `{ "kind": "layer", "layer" }`, `{ "kind": "none" }`.

### keyboard_plan_macro
```jsonc
{
  "macro": {
    "id": "test_hi",                // ^[A-Za-z0-9_.-]+$, max 64; uppercase and '-' ARE allowed
    "name": "Test Hi",              // 1..64, no control chars
    "steps": [                      // 1..N, FIRST step must not be a delay
      { "type": "key", "code": "h" },
      { "type": "key", "code": "i" }
    ],
    "repeat": 1                     // optional
  }
}
```
Step types: `{ "type": "key", "code", "modifiers"? }` and `{ "type": "delay", "ms" }`. Macro steps cannot use consumer keys, `fn`, or `disabled`.

## Error behaviors (observed live)

Validation happens at the trust boundary with strict objects (unknown keys are rejected). Real responses:

| Mistake | Response |
|---|---|
| Snapshot body uses `label` instead of `reason` | `validation` — `Unrecognized key: "label"` (the field is `reason`) |
| Macro first step is a delay | `validation` — `set-macro: A macro cannot start with a delay step` |
| Macro `steps: []` | `validation` — `macro.steps: Too small: expected array to have >=1 items` |
| Color without `#` (e.g. `"86efac"`) | `validation` — `perKey.w: Invalid input` |
| Unknown key id in assignments | `validation` — `assignments.<id>: Invalid key in record` |
| Unknown key code (e.g. `code: "at"`) | `validation` — `assignments.<id>.code: Unknown key code` |
| Apply/restore without `confirm: true` | `confirmation-required` — `confirm must be the boolean true to run this action` (checked before anything else) |

Note: a macro id like `Bad-Id` is **accepted** — the id pattern allows uppercase and hyphens.

## Worked example: paint WASD, then clean up

```
1. keyboard_status                      -> expect mode "read-write"
2. keyboard_snapshot { reason: "baseline before wasd test" }  -> save id B
3. keyboard_plan_lighting { effect:"per-key", base:"#000000",
      perKey:{ w:"#86efac", a:"#86efac", s:"#86efac", d:"#86efac" } }  -> plan id P
4. keyboard_preview_plan { planId: P }  -> read the diff
5. keyboard_apply_plan { planId: P, confirm: true }
      -> applied:true, verified:false (no read-back; check the keyboard)
6. ...do the thing...
7. keyboard_restore { snapshotId: B, confirm: true }  -> back to baseline
```

Remap example (Menu -> `@`): `keyboard_plan_keys { layer:"base", assignments:{ menu:{ kind:"key", code:"digit2", modifiers:["shift"] } } }`, then preview, apply, and restore the baseline snapshot when done.

## Connecting

The daemon's MCP endpoint is `http://127.0.0.1:6465/mcp` (JSON-RPC, accepts `application/json`/`text/event-stream`). The operator decides whether writes are on by starting the daemon with `PERIFMCP_BACKEND=hid` + `PERIFMCP_ALLOW_WRITES=1` + a `PERIFMCP_MODELS_FILE`. An AI client cannot turn writes on through the tools. See `docs/mcp-clients.md` for per-client registration.
