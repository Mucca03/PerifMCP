/**
 * CRC-16/CCITT-FALSE, the variant used by GK6X/Semitek keyboards.
 * Polynomial 0x1021, initial value 0xFFFF, no reflection, no final xor.
 */
export function crc16ccitt(message: Uint8Array, initial = 0xffff): number {
  let crc = initial & 0xffff

  for (const byte of message) {
    for (let bit = 7; bit >= 0; bit -= 1) {
      const inputBit = (byte >> bit) & 1
      const topBit = (crc >> 15) & 1
      crc = (crc << 1) & 0xffff
      if ((topBit ^ inputBit) !== 0) {
        crc ^= 0x1021
      }
    }
  }

  return crc & 0xffff
}
