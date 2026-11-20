import { describe, expect, it } from 'vitest'
import { GIM_K64_LAYOUT } from '../src/layout.js'

describe('GIM K64 layout', () => {
  it('has exactly 64 unique keys', () => {
    expect(GIM_K64_LAYOUT.keyCount).toBe(64)
    expect(GIM_K64_LAYOUT.keys).toHaveLength(64)
    expect(new Set(GIM_K64_LAYOUT.keys.map((key) => key.id)).size).toBe(64)
  })

  it('models the ANSI GK64 bottom rows', () => {
    const byId = new Map(GIM_K64_LAYOUT.keys.map((key) => [key.id, key]))
    expect(byId.get('lshift')?.width).toBe(2)
    expect(byId.get('rshift')?.width).toBe(1)
    expect(byId.get('backslash')?.width).toBe(1.5)
    expect(byId.get('space')?.width).toBe(6.25)
    expect(byId.get('arrowup')?.row).toBe(3)
    expect(byId.get('delete')?.row).toBe(3)
    expect(byId.get('fn')?.row).toBe(4)
  })

  it('ends every row at 15 units', () => {
    for (let row = 0; row < GIM_K64_LAYOUT.rows; row += 1) {
      const keys = GIM_K64_LAYOUT.keys.filter((key) => key.row === row)
      const end = Math.max(...keys.map((key) => key.x + (key.width ?? 1)))
      expect(end).toBe(15)
    }
  })
})
