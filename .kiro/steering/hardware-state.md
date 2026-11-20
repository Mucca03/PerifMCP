---
inclusion: always
---

# Hardware state (PerifMCP)

Technical summary of the connected keyboard and the daemon's live behavior, from a read-write session verified against the real device on 2026-11-20. Update this when the device, firmware, or daemon behavior changes.

## Connected device (live, via `GET /api/status`)

- Model name: **SK64 RGB** (`modelId` 656801886)
- USB: `1ea7:0907`, manufacturer `SEMITEK`, product `USB-HID Gaming Keyboard`
- Transport: `hidraw`, `connection: connected`
- Firmware: `firmwareId` 2418119201, `firmwareVersion` 291
- `deviceId`: 281474976710655
- Matrix: 14 columns x 8 rows
- Layout: 64 keys, ANSI, GK64-style arrows (see `GET /api/layout` for exact ids)

Note: the physical board is labeled **GIM K64 RGB** but the daemon identifies it as **SK64 RGB** from the model data. Both refer to the same hardware.

## Daemon

- Endpoint: HTTP API at `http://127.0.0.1:6465/api/*`, MCP at `http://127.0.0.1:6465/mcp` (JSON-RPC).
- Writes require all three env vars at startup: `PERIFMCP_BACKEND=hid`, `PERIFMCP_ALLOW_WRITES=1`, `PERIFMCP_MODELS_FILE=<path>`. Otherwise mode is `read-only` and `writeDisabledReasons` explains why. An AI cannot enable writes through the tools.
- Default mock backend touches no hardware; `pnpm test` runs against it.

## Critical hardware behavior: no read-back

**The keyboard has no read-back command.** This shapes everything:

- `keyboard_apply_plan` returns `applied: true, verified: false` with an `errors` note that the result cannot be read back. The daemon only confirms that every 64-byte packet was acknowledged with a valid CRC.
- `keyboard_verify` / `POST /api/verify` always return `ok: false` with one `device` mismatch for the same reason, even when the write succeeded. This is not a failure to flag to the user as an error; it is a hardware limitation. Confirm changes visually on the keyboard.
- Because the device state cannot be read, the daemon reconstructs "current config" from `profiles/local/state/<modelId>.json` (the last thing it wrote), and `configSource` is `last-written`. A snapshot captures that known state, not a fresh read of the hardware. Snapshot/restore are reliable for undoing changes *this daemon made*, not for recovering a state set by other software.

## Snapshot / restore (verified)

- `keyboard_snapshot { reason? }` saves current state. The body field is `reason`, not `label`.
- `keyboard_apply_plan` auto-creates a safety snapshot before writing (`snapshotId` in its response).
- `keyboard_restore { snapshotId, confirm: true }` also auto-creates a `safetySnapshotId` before restoring.
- Always take an explicit baseline snapshot before a test and restore it afterward.

## Safety constraints (from AGENTS.md, still in force)

- Semantic tools only; never construct raw 64-byte HID packets.
- Snapshot before every write; keep writes reversible.
- No firmware flashing. No `writeMacVid` (`0x41/0x01`). No vendor `Build/Data` in the repo.
- Do not change key assignments in a way that could lock the user out.

## Where to look

- Live tool schemas and error behaviors: `skills/perifmcp/SKILL.md`.
- Connecting an MCP client: `docs/mcp-clients.md`.
- Shareable lighting profiles: `profiles/examples/`, `profiles/README.md`.
- Request validation source of truth: `apps/daemon/src/schemas.ts` and `apps/daemon/src/limits.ts`.
