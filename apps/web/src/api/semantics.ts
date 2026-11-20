/**
 * Facade over the semantic helpers.
 *
 * Swap: when `packages/core/src/semantics.ts` lands, replace the body with
 *   export { applyChanges, configRevision, diffConfig, hexToRgb, rgbToHex, validateChange, zoneKeys } from '@perifmcp/core'
 * and keep `lightingInputToState` and `describeAssignment` local (they are UI helpers, see mock-semantics.ts).
 */
export * from './mock-semantics'
