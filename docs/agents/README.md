# Sub-agent workflow

Read `AGENTS.md` first. This folder holds one brief per sub-agent. Each brief is meant to be used as the task prompt together with `AGENTS.md`.

## Roles and zones

| Role | Brief | Writes to | Reads |
|---|---|---|---|
| Master | this file | root, `docs/`, `.github/`, contract files (below), `apps/daemon/src/probe.ts`, `profiles/` | everything |
| Protocol | [protocol.md](protocol.md) | `packages/core/src/protocol/`, `layout.ts`, `config.ts`, `client.ts`, `keys.ts`, `semantics.ts`, `packages/core/test/` | contracts |
| Interface | [interface.md](interface.md) | `apps/web/` | contracts, `packages/core` (types and layout only) |
| MCP | [mcp.md](mcp.md) | `apps/daemon/` except `probe.ts` | contracts, `packages/core` |

### Contract files (master only)

Frozen. A sub-agent that needs a change does not edit them: it stops, describes the change it needs and why, and reports it to the master.

```text
packages/core/src/types.ts      config, plan, device types
packages/core/src/service.ts    KeyboardService, plan inputs, errors, snapshots
packages/core/src/api.ts        HTTP routes, error codes and statuses
packages/core/src/tools.ts      MCP tool names and input/output types
packages/core/src/transport.ts  HidConnection, HidTransport
packages/core/src/safety.ts     command allowlist, read-only guard
packages/core/src/index.ts      public exports (the protocol agent may append `export *` lines for its own new files)
```

## Order of work

1. Master: contracts and this folder (done in the first commit of the contracts branch).
2. In parallel, each in its own worktree:
   - Protocol delivers phase 1 (`semantics.ts`, `keys.ts`) first. The MCP agent starts against the signatures in `protocol.md` and swaps in the real code when it lands.
   - Interface works against the in-memory mock API.
   - MCP works against `MockBackend`.
3. Master: reviews each branch, merges, runs the read-only probe, decides when writes are enabled.

## Git

Each sub-agent works in a worktree and a branch, created by the master:

```bash
git worktree add ../MyUsbPorts-protocol -b agent/protocol
git worktree add ../MyUsbPorts-web      -b agent/web
git worktree add ../MyUsbPorts-mcp      -b agent/mcp
```

Sub-agents commit on their own branch with small commits (`feat(core): ...`, `test(daemon): ...`). They do not push, merge or touch `main`. The master integrates.

## Hard rules for every sub-agent

- Never open `/dev/hidraw*`. Do not run `pnpm --filter @perifmcp/daemon probe`. Only the master touches hardware.
- Never write the commands in `FORBIDDEN_COMMANDS` (`0x03` restart, `0x41` USB identity), never implement firmware update.
- Do not copy anything from `/home/mucca/code/GK6X/Build/Data/`. It belongs to jikedingzhi. Reading it to understand a format is fine. Copying values, tables or JSON into this repo is not.
- Code from `GK6X/*.cs` is MIT (pixeltris). Porting logic is allowed. Keep a comment with the source file name.
- No device captures, serial numbers beyond what `docs/hardware.md` already lists, or personal profiles in git.
- Do not edit `udev`, system files, `.github/`, `docs/` outside your own brief, or another role's zone.
- New agent-facing behavior needs a typed schema and a dry-run/plan path.

## Definition of done (per branch)

- `pnpm typecheck` and `pnpm test` pass in the whole workspace.
- New behavior has a test.
- Final report to the master with: files changed, commands run and their result, decisions taken, open questions, and any contract change you need.

## Prompt template

```text
You are the <role> sub-agent for PerifMCP. Work in <worktree path> on branch agent/<role>.
Read AGENTS.md and docs/agents/<role>.md and follow them. Do not edit files outside your zone.
Do not touch hardware. Finish with the report described in docs/agents/README.md.
```
