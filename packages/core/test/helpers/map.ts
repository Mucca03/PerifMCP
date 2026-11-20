import { GIM_K64_LAYOUT, type KeyIndexMap } from '../../src/index.js'

/**
 * Test-only key index map. NOT the real GK64 matrix: logic and location codes are simply the position
 * in the layout, so that the encoders can be exercised without model data. The fn key has no logic code,
 * like in the reference.
 */
export function syntheticMap(logicSize = 64): KeyIndexMap {
  const logic: Record<string, number> = {}
  const location: Record<string, number> = {}
  GIM_K64_LAYOUT.keys.forEach((key, index) => {
    location[key.id] = index
    if (key.id !== 'fn') logic[key.id] = index
  })
  return { logic, location, logicSize }
}
