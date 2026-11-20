# Hardware notes: GIM K64 RGB

## Identification

| Field | Value |
|---|---|
| Label model | GIM K64 RGB Keyboard |
| Manufacturer | ShenZhen RiYueZe Technology Co., LTD |
| Serial | `K6420J000098` |
| USB VID:PID | `1ea7:0907` |
| USB descriptor manufacturer | SEMITEK |
| USB descriptor product | USB-HID Gaming Keyboard |
| Layout | 64 keys, ANSI |
| Kernel driver | `hid_semitek` |

## HID interfaces

| Interface | Purpose | Endpoint | Report |
|---|---|---|---|
| 0 | boot keyboard | `0x81` IN | 8 bytes |
| 1 | vendor control (`0xFF00/0x50`) | `0x83` IN, `0x04` OUT | 64 bytes |
| 2 | NKRO keyboard + consumer + mouse | `0x82` IN | 64 bytes |

PerifMCP uses interface 1 (`/dev/hidraw1`). Do not unbind `hid_semitek`.

## Linux permissions

The tested rule is:

```udev
KERNEL=="hidraw*", ATTRS{idVendor}=="1ea7", ATTRS{idProduct}=="0907", MODE="0660", GROUP="plugdev", TAG+="uaccess"
```

Install as `/etc/udev/rules.d/99-perifmcp.rules` and reload:

```bash
sudo udevadm control --reload-rules
sudo udevadm trigger --subsystem-match=hidraw
```

Expected result:

```text
crw-rw---- root plugdev /dev/hidraw1
```

## Protocol facts

- 64-byte buffers.
- Byte 0: command.
- Byte 1: subcommand.
- Bytes 2-5: `UInt32LE` header.
- Bytes 6-7: `UInt16LE` CRC.
- Body starts at byte 8.
- CRC: CRC-16/CCITT-FALSE, initial `0xFFFF`, polynomial `0x1021`, computed over all 64 bytes with bytes 6-7 set to zero.

Useful commands:

| Command | Subcommand | Meaning |
|---|---|---|
| `0x01` | `0x01` | firmware version |
| `0x01` | `0x02` | device ID (6 bytes) |
| `0x01` | `0x08` | model ID |
| `0x01` | `0x09` | matrix columns/rows |
| `0x0c` | - | ping |
| `0x15` | `0x03` | enable/disable key reporting |
| `0x17` | `0x01` | LE configuration |
| `0x22` | mode | write key data |
| `0x25` | mode | write macro |
| `0x26` | mode | write per-key lighting |
| `0x27` | mode | write lighting data |

## Cautions

- Firmware update: not supported by this project.
- `writeMacVid` (`0x41/0x01`): do not use. It can change the USB identity to Apple and break the tool.
- Reset configuration combo from the vendor config: `Fn+Esc+Q`. Verify in the manual before relying on it.
- Some users report handshake failures behind USB 3 hubs. Use a direct port or a USB 2.0 port if needed.

## Layout assumptions

The 64-key ANSI layout is documented in `packages/core/src/layout.ts`:

- row 1: Esc, numbers, `-`, `=`, Backspace;
- row 2: Tab, QWERTY, `[`, `]`, `\`;
- row 3: Caps, ASDF, `;`, `'`, Enter;
- row 4: 2u LShift, ZXCV, punctuation, 1u RShift, Up, Del;
- row 5: 1.25u Ctrl/Win/Alt, 6.25u Space, Fn, Menu, Left, Down, Right.

If the real matrix differs, correct the layout after the read-only handshake; do not guess the wiring.
