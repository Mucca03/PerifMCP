# AI tool contract

The MCP server is the only supported way for an agent to control the keyboard. The agent describes intent; the daemon validates it, produces a plan and applies the plan only after confirmation.

## Planned tools

### Status and inspection

| Tool | Input | Output |
|---|---|---|
| `keyboard_status` | none | connection, model, firmware, matrix, active layer |
| `keyboard_get_layout` | none | 64-key layout with positions and labels |
| `keyboard_get_config` | `{ layer?: Layer }` | current layer assignments |
| `keyboard_get_macros` | none | macro list |
| `keyboard_get_lighting` | none | current effect and per-key colors |

### Planning

| Tool | Input | Output |
|---|---|---|
| `keyboard_plan_keys` | `{ layer, assignments }` | plan ID, diff, warnings |
| `keyboard_plan_macro` | `{ macro }` | plan ID, diff, warnings |
| `keyboard_plan_lighting` | `{ zones?, perKey?, base?, effect?, color?, speed?, direction?, brightness? }` | plan ID, diff, warnings |
| `keyboard_preview_plan` | `{ planId }` | human-readable diff and affected keys |
| `keyboard_apply_plan` | `{ planId, confirm: true }` | applied, verified, snapshot ID |
| `keyboard_verify` | none | read-back comparison |

### Recovery

| Tool | Input | Output |
|---|---|---|
| `keyboard_snapshot` | none | snapshot ID |
| `keyboard_list_snapshots` | none | snapshot metadata |
| `keyboard_restore` | `{ snapshotId, confirm: true }` | applied, verified |

## Semantic vocabulary

The agent works with:

- **keys**: `escape`, `space`, `arrowup`, `fn`, `lshift`, etc.;
- **layers**: `base`, `fn1`, `fn2`, `fn3`;
- **zones**: `wasd`, `alphanumeric`, `top-row`, `arrows`, `modifiers`;
- **effects**: `off`, `solid`, `breathing`, `rainbow`, `wave`, `reactive`, `per-key`;
- **colors**: `#rrggbb`;
- **macros**: ordered key/delay steps with optional repeat.

It never works with matrix bytes, LED offsets or raw packets.

## Example

User: “Pon WASD en rojo, el resto en azul oscuro y un latido lento.”

```text
keyboard_status()
keyboard_get_layout()
keyboard_plan_lighting({
  zones: { wasd: "#ef4444" },
  base: "#1e3a8a",
  effect: "breathing",
  speed: 30
})
keyboard_preview_plan({ planId })
# user confirms
keyboard_apply_plan({ planId, confirm: true })
keyboard_verify()
keyboard_snapshot()
```

## Rules

- A plan is immutable once created.
- `apply` requires `confirm: true`.
- If the model or protocol version is unknown, only read-only tools are available.
- A failed verification leaves the previous snapshot intact and reports the mismatch.
- Macro recording needs the UI or vendor callbacks; do not claim the agent can physically press keys.
