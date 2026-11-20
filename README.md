# PerifMCP

PerifMCP is a local-first configuration studio for the **GIM K64 RGB** and compatible GK6X/Semitek keyboards.

The goal is to make the keyboard usable from two interfaces that share one state:

- a web UI inspired by the visual language of `muccaPortfolio2`;
- an MCP server so an AI agent can inspect, plan, apply and verify changes safely.

> Status: initial scaffold. No firmware update, no vendor VID change and no hardware writes are implemented yet.

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
apps/daemon    local HTTP API + MCP server (planned)
packages/core  protocol, CRC, packet codec, layout, config types
docs           architecture, hardware and AI-tool contracts
profiles       example/shareable configuration files
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

The UI and daemon are not wired yet. The first milestone is a read-only probe:

```bash
pnpm --filter @perifmcp/core test
```

## License

The code license is pending confirmation. The model/lighting data from the original vendor and from `pixeltris/GK6X` is **not** included in this repository and is not covered by any MIT grant.
