# Using the keyboard from another AI (MCP)

The daemon is an MCP server. Any AI client that can connect to an MCP server over HTTP can use the 14 `keyboard_*` tools. A new AI instance does not find it by itself: the server has to be running, and the client has to be told its URL once.

## 1. Start the daemon

From the repository root:

```bash
# read-only: status, layout, config, plans and previews. Nothing is written.
PERIFMCP_BACKEND=hid PERIFMCP_MODELS_FILE="$PWD/profiles/local/models.json" \
  pnpm --filter @perifmcp/daemon dev

# the same, with writes allowed
PERIFMCP_BACKEND=hid PERIFMCP_MODELS_FILE="$PWD/profiles/local/models.json" PERIFMCP_ALLOW_WRITES=1 \
  pnpm --filter @perifmcp/daemon dev
```

Use `PERIFMCP_BACKEND=mock` to try it without the keyboard. The endpoint is `http://127.0.0.1:6465/mcp`. Only the person who starts the daemon decides whether writes are on. An AI cannot turn them on through the tools.

## 2. Register it in the client (once)

| Client | How | Checked |
|---|---|---|
| Kiro | Add to `~/.kiro/settings/mcp.json` (all workspaces) or `.kiro/settings/mcp.json` (one workspace): `{ "mcpServers": { "perifmcp": { "url": "http://127.0.0.1:6465/mcp" } } }`. Saving the file reloads it. `/mcp` lists the server and its tools. | Format from the Kiro docs (kiro.dev/docs/mcp/configuration). Not run against Kiro here. |
| Claude Code | `claude mcp add --transport http perifmcp http://127.0.0.1:6465/mcp` | From memory of the Claude Code docs. Not run here. |
| Others (OpenCode, ...) | Use the client's setting for a remote or HTTP MCP server and give it the URL. | Not checked. |

Kiro asks for approval before each MCP tool call unless the tool is listed in `autoApprove` or allowed in `~/.kiro/settings/permissions.yaml`. A workspace-level `mcp.json` is only loaded after the folder is trusted. A custom agent only sees the server if it includes it. Keep `keyboard_apply_plan` and `keyboard_restore` out of `autoApprove`.

## 3. What a new AI can do

With the daemon running, a client that was never told about this project can list the tools, read the layout and status, create a plan, preview it and apply it. This was tested with the official MCP SDK client against the daemon on the mock backend:

- 14 tools listed with their descriptions;
- `keyboard_plan_lighting` and `keyboard_preview_plan` worked;
- `keyboard_apply_plan` without `confirm: true` was refused (`confirmation-required`);
- with `confirm: true` but writes off it was refused (`write-disabled`).

Typical request: "put WASD in red and the rest dark blue, breathing slowly". The AI calls `keyboard_status`, `keyboard_get_layout`, `keyboard_plan_lighting`, `keyboard_preview_plan`, then, after you agree, `keyboard_apply_plan` with `confirm: true`.

## Limits an AI should know

- The keyboard cannot be read back. `keyboard_apply_plan` returns `applied: true, verified: false` on purpose. Look at the keyboard to check. `keyboard_status` reports `configSource`: `last-written` means the config is what this app last wrote, not a reading.
- Lighting effects that can be written today: `off`, `solid`, `per-key` and `breathing`. `rainbow`, `wave` and `reactive` are planned but make apply fail.
- Writing lighting erases the effects the keyboard had stored. They cannot be recovered from the program.
- There is no tool for raw HID, firmware or the USB identity, and there will not be one.
- Each request is independent (the MCP endpoint is stateless). Plans live in the daemon for 30 minutes.

## Security

The daemon only listens on `127.0.0.1` and rejects requests with a foreign `Host` or `Origin` header. MCP clients that run as local programs send no `Origin` and work. A web page open in your browser cannot call it.
