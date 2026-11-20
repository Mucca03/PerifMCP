# AGENTS.md

Instructions for AI agents working on PerifMCP.

## Mission

Build a safe, local-first configuration tool for the GIM K64 RGB (GK6X/Semitek protocol). The web UI and MCP server must share one semantic model. The protocol is an implementation detail, not an agent API.

## Non-negotiable safety rules

1. **Read-only first.** Do not write to `/dev/hidraw1` until the read-only probe has identified the model and the write path has tests.
2. **No raw HID tools.** Agents call semantic tools such as `keyboard.plan_lighting` and `keyboard.apply_plan`; they never construct 64-byte packets.
3. **Snapshot before apply.** Every write must be preceded by a snapshot and must be reversible.
4. **No firmware update.** Do not implement or invoke firmware flashing.
5. **No `writeMacVid`.** The `0x41/0x01` command can make the keyboard identify as Apple hardware and break the control channel.
6. **Do not add proprietary data.** `GK6X/Build/Data` belongs to jikedingzhi. Keep model data out of the repo unless the user explicitly provides a redistributable source.
7. **Do not modify udev or system files without explicit approval.** The expected rule is documented in `docs/hardware.md`.

## Code ownership

| Area | Owner | Notes |
|---|---|---|
| `packages/core/src/types.ts` | master agent | Freeze contracts before parallel work |
| `packages/core/src/protocol/` | protocol subagent | CRC, packets, LE, decoders, tests |
| `apps/web/` | UI subagent | Visual keyboard, editors, mock API |
| `apps/daemon/` | MCP subagent | HTTP API, MCP tools, plans, snapshots |
| root, docs, GitHub | master agent | Integration, review, commits |

Work in separate branches or worktrees. Do not edit another owner's files without coordination.

## Definition of done

- `pnpm typecheck` passes.
- `pnpm test` passes.
- New protocol behavior has a unit test.
- New agent-facing behavior has a typed schema and a dry-run/plan path.
- No secrets, device captures or vendor data are committed.

## Device facts

- USB `1ea7:0907`
- Control interface: `usagePage 0xFF00`, `usage 0x50`
- 64-byte reports
- CRC-16/CCITT-FALSE over the full 64-byte buffer with CRC bytes zeroed
- 64-key ANSI layout, GK64-style arrows
- Reset configuration combo: `Fn+Esc+Q` (verify in the manual before using)
