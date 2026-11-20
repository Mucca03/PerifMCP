# PerifMCP

PerifMCP is a local-first configuration studio for the **GIM K64 RGB** and compatible GK6X/Semitek keyboards.

The goal is to make the keyboard usable from two interfaces that share one state:

- a web UI inspired by the visual language of `muccaPortfolio2`;
- an MCP server so an AI agent can inspect, plan, apply and verify changes safely.

> Status: the semantic core, the web UI and the local daemon (HTTP API + MCP server) are in place and tested against a mock backend. Writes to the device stay behind a read-only probe. No firmware update and no vendor VID change are implemented.

## Why this exists

The keyboard identifies as `1ea7:0907` and uses the GK6X/Semitek 64-byte HID protocol. The vendor software is Windows-only and the community projects are archived or partial. PerifMCP keeps the protocol layer small, typed and testable, and puts a semantic layer on top:

```text
web UI / MCP tools
        │
        ▼
  plan → preview → apply → verify
        │
        ▼
  @perifmcp/core (protocol, layout, keymaps, macros, lighting)
        │
        ▼
  /dev/hidraw1 (usage page 0xFF00)
```

## Repository layout

```text
apps/web       Vite + React UI with a 64-key visual keyboard
apps/daemon    local HTTP API + MCP server
packages/core  protocol, CRC, packet codec, layout, config types, semantics
docs           architecture, hardware, AI-tool and MCP-client contracts
profiles       example/shareable lighting profiles
```

## Device

- Model: **GIM K64 RGB Keyboard**
- Manufacturer on label: ShenZhen RiYueZe Technology Co., LTD
- Serial: `K6420J000098`
- USB: `1ea7:0907` (SHARKOON / SEMITEK)
- Layout: 64 keys, ANSI, GK64-style arrows
- Control channel: HID interface with `usagePage 0xFF00`, `usage 0x50`
- Linux: `/dev/hidraw1` once the udev rule is installed

The kernel keeps `hid_semitek` bound. PerifMCP does not replace it.

## Safety rules

- Read-only by default.
- Never send raw HID packets from the UI or an agent. Use semantic tools.
- Take a snapshot before applying a plan.
- Never update firmware.
- Never call the vendor `writeMacVid` command (`0x41/0x01`).
- Do not redistribute the proprietary `Build/Data` directory from `pixeltris/GK6X`.

## Quick start

Requirements: Node.js 22+, pnpm 10+ and a Chromium-based browser.

```bash
pnpm install
pnpm dev
```

`pnpm dev` starts the web UI and the daemon. Without a keyboard the daemon uses a mock backend, so the full plan → preview → apply → verify flow works offline and never touches hardware. See [Enabling device writes](#enabling-device-writes) to write to a real keyboard. To check the protocol and services:

```bash
pnpm test
pnpm typecheck
```

The read-only hardware probe identifies the connected model without writing to it:

```bash
pnpm --filter @perifmcp/daemon probe
```

## MCP tools

An AI agent talks to the daemon's MCP server with semantic tools, never raw HID packets. Connection details are in `docs/mcp-clients.md`. The tools are:

| Tool | Purpose |
|---|---|
| `keyboard_status` | report the connected model and backend |
| `keyboard_get_layout` | read the 64-key layout |
| `keyboard_get_config` | read the current key assignments |
| `keyboard_get_macros` | read stored macros |
| `keyboard_get_lighting` | read the current lighting state |
| `keyboard_plan_keys` | plan a key remap |
| `keyboard_plan_macro` | plan a macro change |
| `keyboard_plan_lighting` | plan a lighting change |
| `keyboard_preview_plan` | show what a plan would write |
| `keyboard_apply_plan` | apply a plan (requires confirmation) |
| `keyboard_snapshot` | capture the current state before a write |
| `keyboard_list_snapshots` | list saved snapshots |
| `keyboard_restore` | restore a snapshot |
| `keyboard_verify` | check the device matches the applied plan |

Shareable lighting profiles live in `profiles/examples/`. Each is a plan input for `keyboard_plan_lighting` (or `POST /api/plans/lighting`); see `profiles/README.md`.

## Enabling device writes

By default the daemon runs the **mock** backend: plans, previews and applies work, but nothing reaches the keyboard. `pnpm test` runs against this mock, so a test run never touches your hardware.

Writing to the real keyboard (remapping keys, changing colors, storing macros) is **off unless you turn it on**. The daemon reports `read-write` only when all three of these are true:

1. `PERIFMCP_BACKEND=hid` — use the real HID backend instead of the mock.
2. `PERIFMCP_ALLOW_WRITES=1` — opt in to writes. Without it the connection stays `read-only`.
3. `PERIFMCP_MODELS_FILE=/path/to/models.json` — a model file with the key index for your board, supplied by you and never committed.

```bash
# Read-write session against the connected keyboard
PERIFMCP_BACKEND=hid \
PERIFMCP_ALLOW_WRITES=1 \
PERIFMCP_MODELS_FILE=/path/to/models.json \
pnpm --filter @perifmcp/daemon dev
```

Check the current mode any time with `keyboard_status` or `GET /api/status`; it returns `read-only` or `read-write` and lists why writes are blocked.

> **Once writes are enabled, any client of the daemon — including an AI agent over MCP — can change key assignments, lighting and macros on the physical keyboard.** Keep the mock backend for development, enable the HID backend only when you intend to write, and take a snapshot (`keyboard_snapshot`) first so every change is reversible. Enabling writes is at your own risk.

## Disclaimer

Not affiliated with Semitek, GIM or Sharkoon. This is an independent, community project. Use at your own risk.

## License

The code in this repository is released under the **MIT License** (see [`LICENSE`](./LICENSE)).

This grant covers only the PerifMCP source code. It does **not** cover the keyboard vendor's firmware or model/lighting data, nor the `Build/Data` directory from [`pixeltris/GK6X`](https://github.com/pixeltris/GK6X). That data is not included in this repository and is not redistributed here; obtain it from its own source under its own terms.
