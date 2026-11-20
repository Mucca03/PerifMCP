#!/usr/bin/env python3
"""
Independent generator for the golden values used in test/golden.test.ts.

It re-implements the documented formats (see the header comments of the protocol modules, which cite
GK6X/KeyboardDevice.cs, KeyValues.cs, UserDataFile.cs and CommandLogger.cs) without sharing any code with
the TypeScript encoders, and prints the expected bytes. Run: python3 test/golden/gen_golden.py
Nothing here touches hardware or vendor data.
"""
import hashlib
import struct


def make_table():
    table = []
    for i in range(256):
        crc = i << 8
        for _ in range(8):
            crc = ((crc << 1) ^ 0x1021) & 0xFFFF if crc & 0x8000 else (crc << 1) & 0xFFFF
        table.append(crc)
    return table


TABLE = make_table()


def crc16(data, crc=0xFFFF):
    for byte in data:
        crc = (TABLE[(byte ^ (crc >> 8)) & 0xFF] ^ (crc << 8)) & 0xFFFF
    return crc


def packet(cmd, sub, header4, body=b""):
    """cmd, sub, 4 bytes of 'header' (bytes 2..5), crc (6..7), body (8..63)"""
    assert len(header4) == 4 and len(body) <= 56
    buf = bytearray(64)
    buf[0], buf[1] = cmd, sub
    buf[2:6] = header4
    buf[8:8 + len(body)] = body
    struct.pack_into("<H", buf, 6, crc16(bytes(buf)))
    return bytes(buf)


def buffered(cmd, layer, payload, length_byte):
    count = len(payload) // 56 + 1
    out = []
    for i in range(count):
        off = i * 56
        chunk = payload[off:off + 56]
        h = bytearray(4)
        if count > 1:
            h[0], h[1] = off & 0xFF, (off >> 8) & 0xFF
            h[length_byte - 2] = len(chunk)
        out.append(packet(cmd, layer, bytes(h), chunk))
    return out


def digest(packets):
    return hashlib.sha256(b"".join(packets)).hexdigest()


def u32(v):
    return struct.pack("<I", v)


def macro_record(index, actions, repeat_type, repeat_count, trailing):
    """actions: (key, mod, state, type, delay)"""
    int_count = len(actions) * 2 - (0 if trailing else 1)
    slots = b""
    for i, (key, mod, state, typ, delay) in enumerate(actions):
        slot = bytes([key, mod, state, typ])
        if i < len(actions) - 1 or (trailing and i == len(actions) - 1):
            slot += struct.pack("<H", delay) + bytes([0, 3])
        else:
            slot += bytes(4)
        slots += slot
    slots += bytes(8 * (63 - len(actions)))
    crc = crc16(slots[:int_count * 4])
    return struct.pack("<HHBBBB", 0x55AA, crc, int_count, index, repeat_type, repeat_count) + slots


def mask(keys):
    m = bytearray(22)
    for k in keys:
        m[k // 8] |= 1 << (k % 8)
    return bytes(m)


def show(name, packets):
    print(f"--- {name}: {len(packets)} packet(s), sha256 {digest(packets)}")
    for p in packets[:3]:
        print("   ", p.hex())


# A, B: reset and set-layer
show("reset base/macros", [packet(0x21, 1, bytes([4, 0, 0, 0]))])
show("set layer base", [packet(0x0B, 1, bytes(4))])

# C: key set, single packet. a, escape, unused, macro 0
vals = [0x02000400, 0x02002900, 0xFFFFFFFF, 0x0A010000]
show("keyset 0x22 base single", buffered(0x22, 1, b"".join(u32(v) for v in vals), 4))
show("fn keyset 0x31 layer1 single", buffered(0x31, 2, b"".join(u32(v) for v in vals), 4))

# D: key set multi packet: 30 values 0x02000400 + (i << 8)
vals = [0x02000400 + (i << 8) for i in range(30)]
show("keyset 0x22 base 30 values", buffered(0x22, 1, b"".join(u32(v) for v in vals), 4))

# I: exactly 56 bytes -> trailing empty packet
payload = bytes(range(56))
show("0x22 56 bytes", buffered(0x22, 1, payload, 4))

# E: macros
ctrl_c = [
    (0, 0x01, 1, 1, 0), (0x06, 0, 1, 1, 0), (0, 0x01, 2, 1, 0), (0x06, 0, 2, 1, 100),
]
rec1 = macro_record(0, ctrl_c, 1, 2, True)
print("macro ctrl+c, 100ms trailing, repeat 2: first 40 bytes", rec1[:40].hex(), "sha", hashlib.sha256(rec1).hexdigest())
rec2 = macro_record(1, [(0x04, 0, 1, 1, 0), (0x04, 0, 2, 1, 0)], 1, 1, False)
print("macro a, no trailing: first 24 bytes", rec2[:24].hex(), "sha", hashlib.sha256(rec2).hexdigest())
show("macros 0x25 two records", buffered(0x25, 1, rec1 + rec2, 4))

# F: static lighting: slots 0 and 5 lit, slot 5 = (10,20,30,255), slot 0 = (255,0,0,255)
colors = bytearray(704)
colors[0:4] = bytes([255, 0, 0, 255])
colors[20:24] = bytes([10, 20, 30, 255])
rec = struct.pack("<HH", 0, 704) + bytes(colors)
table = bytearray(b"\xff" * 512)
struct.pack_into("<iiii", table, 0, 512, 1, 0, 0)
payload = bytes(table) + rec
print("static lighting payload len", len(payload), "table[0:16]", payload[:16].hex())
show("lighting 0x27 static", buffered(0x27, 1, payload, 5))

# G: dynamic lighting
frames = [(2, [0, 9])]
params = [(2, [0, 9], (1, 2, 3, 255), 5, 7)]
table = bytearray(b"\xff" * 512)
data = b""
for count, keys in frames:
    for _ in range(count):
        data += struct.pack("<HH", 3, 22) + mask(keys)
pdata = b""
for ctype, keys, (r, g, b, a), v1, v2 in params:
    pdata += bytes([ctype, 32]) + mask(keys) + bytes([r, g, b, a]) + struct.pack("<HH", v1, v2)
struct.pack_into("<iiii", table, 0, 512, 2, 512 + len(data), 1)
payload = bytes(table) + data + pdata
print("dynamic lighting payload len", len(payload), "table[0:16]", payload[:16].hex(), "sha", hashlib.sha256(payload).hexdigest())
print("frame record", data[:26].hex())
print("param record", pdata.hex())
show("lighting 0x27 dynamic", buffered(0x27, 1, payload, 5))

# G2: breathing built from the semantic state (see `breathingEffect` in lighting.ts).
# All 64 keys of the synthetic map (location codes 0..63) breathe in one color. Speed 50 -> ramp of 19 ticks,
# so value1 = 100 // 19 = 5 and the stay count is 5. Alpha is 0 in dynamic parameters.
all_keys = list(range(64))
b_frames = [(1, all_keys)]
b_params = [(2, all_keys, (134, 239, 172, 0), 100 // 19, 5)]
b_table = bytearray(b"\xff" * 512)
b_data = b""
for count, keys in b_frames:
    for _ in range(count):
        b_data += struct.pack("<HH", 3, 22) + mask(keys)
b_pdata = b""
for ctype, keys, (r, g, b, a), v1, v2 in b_params:
    b_pdata += bytes([ctype, 32]) + mask(keys) + bytes([r, g, b, a]) + struct.pack("<HH", v1, v2)
struct.pack_into("<iiii", b_table, 0, 512, 1, 512 + len(b_data), 1)
b_payload = bytes(b_table) + b_data + b_pdata
print("breathing payload len", len(b_payload), "table[0:16]", b_payload[:16].hex(), "sha", hashlib.sha256(b_payload).hexdigest())
print("breathing param record", b_pdata.hex())
show("lighting 0x27 breathing", buffered(0x27, 1, b_payload, 5))

# H: key press effects
show("0x26 key press", buffered(0x26, 1, bytes([0xFF, 3, 0xFF, 0, 0xFF]), 4))


# J: LE container (GK6X/CMFile.cs Encrypt): type LIGHT (2), time 1700000000, body 00 01 02 03 04 05 06 07 08 09
def le_container(type_id, type_name, time, body):
    name8 = type_name.encode().ljust(8, b"\0")
    key = crc16(name8, crc16(type_name.encode()))
    enc = bytearray()
    for b in body:
        enc.append(b ^ (key & 0xFF))
        key = crc16(bytes([b]), key)
    header = bytearray(32)
    struct.pack_into("<IIIIIB", header, 0, 0x434D4631, 0, time, len(body), crc16(body), type_id)
    header[24:32] = name8
    struct.pack_into("<I", header, 4, crc16(bytes(header)))
    return bytes(header) + bytes(enc)


le = le_container(2, "LIGHT", 1700000000, bytes(range(10)))
print("LE container LIGHT:", le.hex())
le = le_container(5, "MACRO", 1700000000, b"hello")
print("LE container MACRO:", le.hex())
