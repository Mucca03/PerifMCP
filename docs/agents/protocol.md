# Brief: protocol sub-agent

Zone: `packages/core/src/protocol/`, `layout.ts`, `config.ts`, `client.ts`, new `keys.ts` and `semantics.ts`, and `packages/core/test/`. Do not edit the contract files listed in `README.md`.

Goal: everything between the semantic model and the 64-byte packets, as pure, portable, tested TypeScript. No Node or DOM dependency, no I/O.

## Phase 1: semantic helpers (deliver first, the MCP agent needs them)

Create `semantics.ts` and `keys.ts` and append their `export *` lines to `index.ts` (the only edit allowed there). Signatures are fixed:

```ts
// semantics.ts
configRevision(config: KeyboardConfig): string            // stable hash of canonical JSON (sorted keys). Sync, no node:crypto.
applyChanges(config: KeyboardConfig, changes: ConfigChange[]): KeyboardConfig   // pure, never mutates the input
diffConfig(before: KeyboardConfig, after: KeyboardConfig): ConfigDiffEntry[]    // paths like `layers.base.capslock`, `lighting.effect`
zoneKeys(zone: LightingZone, layout?: KeyboardLayout): string[]                 // wasd, alphanumeric, top-row, arrows, modifiers
hexToRgb(hex: string): RGBColor | undefined
rgbToHex(color: RGBColor): HexColor
validateChange(change: ConfigChange, layout?: KeyboardLayout): string[]         // error messages, empty when valid
```

```ts
// keys.ts
KEY_CODES: readonly string[]          // vocabulary for KeyAssignment.code and MacroStep.code
isKeyCode(code: string): boolean
```

Rules:
- Key codes follow the ids already used in `layout.ts` (`escape`, `digit1`, `arrowup`, ...). Build the table from the public USB HID usage table, not from `Build/Data/keys.json`.
- Lighting units: `LightingState.brightness` and `speed` are percent, 0-100 (the plan inputs already are). Update `createDefaultConfig` (currently `brightness: 180`, `speed: 2`) and its tests. Device units are decided later in the encoder.
- Zones: `wasd` = w, a, s, d. `alphanumeric` = letters and digits. `top-row` = row 0. `arrows` = the four arrow keys. `modifiers` = keys with `zone: 'modifier'`. Test that every key id returned exists in the layout.
- Tests: apply then diff round-trips, `applyChanges` does not mutate, revision changes iff the config changes, every zone is non-empty.

## Phase 2: encoders and decoders (no hardware)

Build pure functions that turn a config change into the list of 64-byte packets and back:

- key data (`0x22`), macros (`0x25`), per-key lighting effect (`0x26`), lighting data (`0x27`), Fn data (`0x31`), LE container (`protocol/le.ts`);
- decoders for read-back, so `verify` can compare.

Reference for layouts and sequencing: `/home/mucca/code/GK6X/GK6X/` (`Packet.cs`, `KeyboardDevice.cs`, `KeyboardState.cs`, `UserDataFile.cs`, `KeyValues.cs`, `CMFile.cs`, `OpCodes.cs`, `Enums.cs`). The code is MIT, the data is not.

Rules:
- Each encoder needs golden-byte tests built by hand from the documented format. State the source in a comment (file and method of the reference).
- Encoders only return packets. They never send. Sending goes through `Gk6xClient` over a `guardConnection` wrapper.
- Any new `Gk6xClient` method that writes must use a command listed in `WRITE_RULES` in `safety.ts`. If you need a command that is not there, report it to the master. Do not add it yourself.
- Do not use `0x03` or `0x41`. Do not implement firmware update.
- Unknowns stay unknown. If the reference does not explain a field, write `// unverified` and say so in the report. Do not guess to make a test pass.

## Phase 3: model and matrix (blocked on the master)

The key matrix, model id and firmware come from the read-only probe, which only the master runs. Until the master provides the probe output:

- Keep `layout.ts` as is. Do not change the wiring assumptions.
- Model records (`ModelRecord` in `client.ts`) are loaded only from a file path supplied at runtime. Do not commit model data.

## Done when

- Phase 1 merged to the agent branch with tests, then phase 2 with golden tests.
- `pnpm typecheck` and `pnpm test` pass.
- The report lists every `unverified` item and every command you needed that is not in `safety.ts`.
