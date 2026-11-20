/**
 * zod schemas for every input that crosses the trust boundary (HTTP bodies and MCP tool inputs).
 *
 * Each schema is checked at compile time against the contract type it validates (see the
 * `Assert` block at the end of the file). With `exactOptionalPropertyTypes` on, zod's
 * `a?: T | undefined` is compared after `Exact<>` removes the extra `| undefined`.
 */
import { z } from 'zod'
import { DEFAULT_LAYOUT, KeyboardServiceError, LAYERS, LIGHTING_EFFECTS, LIGHTING_ZONES } from '@perifmcp/core'
import type {
  KeyAssignment,
  KeysPlanInput,
  LightingPlanInput,
  Macro,
  MacroPlanInput,
  MacroStep,
  Modifier,
  ToolContract,
} from '@perifmcp/core'
import {
  CONTROL_CHARS_RE,
  MACRO_ID_RE,
  MAX_ID_LENGTH,
  MAX_KEY_MODIFIERS,
  MAX_MACRO_DELAY_MS,
  MAX_MACRO_ID_LENGTH,
  MAX_MACRO_NAME_LENGTH,
  MAX_MACRO_REPEAT,
  MAX_MACRO_STEPS,
  MAX_REASON_LENGTH,
  MIN_MACRO_DELAY_MS,
  MIN_MACRO_REPEAT,
} from './limits.js'
import { isKeyCode } from './service/semantics-stub.js'
import { stripUndefined, validationError, zodIssues } from './service/util.js'

export const MODIFIERS = ['ctrl', 'shift', 'alt', 'gui'] as const

const LAYOUT_KEY_IDS: ReadonlySet<string> = new Set(DEFAULT_LAYOUT.keys.map((key) => key.id))

// ---------------------------------------------------------------------------
// Building blocks
// ---------------------------------------------------------------------------

export const layerSchema = z.enum(LAYERS)

const modifiersSchema = z.array(z.enum(MODIFIERS)).max(MAX_KEY_MODIFIERS)

const keyCodeSchema = z
  .string()
  .max(MAX_ID_LENGTH)
  .refine((code) => isKeyCode(code), 'Unknown key code')

const keyIdSchema = z
  .string()
  .max(MAX_ID_LENGTH)
  .refine((id) => LAYOUT_KEY_IDS.has(id), 'Unknown key id')

/** `#rrggbb`. The template literal makes the inferred type `#${string}` (HexColor). */
export const hexColorSchema = z.templateLiteral(['#', z.string().regex(/^[0-9a-fA-F]{6}$/, 'Expected #rrggbb')])

const percentSchema = z.number().int().min(0).max(100)

const idSchema = z.string().min(1).max(MAX_ID_LENGTH)

const reasonSchema = z
  .string()
  .max(MAX_REASON_LENGTH)
  .refine((value) => !CONTROL_CHARS_RE.test(value), 'Control characters are not allowed')

// ---------------------------------------------------------------------------
// Domain inputs
// ---------------------------------------------------------------------------

export const keyAssignmentSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('key'), code: keyCodeSchema, modifiers: modifiersSchema.optional() }),
  z.strictObject({
    kind: z.literal('macro'),
    macroId: z.string().min(1).max(MAX_MACRO_ID_LENGTH).regex(MACRO_ID_RE),
  }),
  z.strictObject({ kind: z.literal('layer'), layer: layerSchema }),
  z.strictObject({ kind: z.literal('none') }),
])

export const macroStepSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('key'), code: keyCodeSchema, modifiers: modifiersSchema.optional() }),
  z.strictObject({
    type: z.literal('delay'),
    ms: z.number().int().min(MIN_MACRO_DELAY_MS).max(MAX_MACRO_DELAY_MS),
  }),
])

export const macroSchema = z.strictObject({
  id: z.string().min(1).max(MAX_MACRO_ID_LENGTH).regex(MACRO_ID_RE),
  name: z
    .string()
    .min(1)
    .max(MAX_MACRO_NAME_LENGTH)
    .refine((value) => !CONTROL_CHARS_RE.test(value), 'Control characters are not allowed'),
  steps: z.array(macroStepSchema).min(1).max(MAX_MACRO_STEPS),
  repeat: z.number().int().min(MIN_MACRO_REPEAT).max(MAX_MACRO_REPEAT).optional(),
})

export const keysPlanInputSchema = z.strictObject({
  layer: layerSchema,
  assignments: z
    .record(keyIdSchema, keyAssignmentSchema)
    .refine((value) => Object.keys(value).length > 0, 'At least one assignment is required'),
})

export const macroPlanInputSchema = z.strictObject({ macro: macroSchema })

export const lightingPlanInputSchema = z.strictObject({
  zones: z.partialRecord(z.enum(LIGHTING_ZONES), hexColorSchema).optional(),
  perKey: z.record(keyIdSchema, hexColorSchema).optional(),
  base: hexColorSchema.optional(),
  effect: z.enum(LIGHTING_EFFECTS).optional(),
  color: hexColorSchema.optional(),
  speed: percentSchema.optional(),
  brightness: percentSchema.optional(),
  direction: z.number().int().min(0).max(255).optional(),
})

// ---------------------------------------------------------------------------
// Tool inputs and HTTP bodies
// ---------------------------------------------------------------------------

export const emptyInputSchema = z.strictObject({})
export const getConfigInputSchema = z.strictObject({ layer: layerSchema.optional() })
export const previewPlanInputSchema = z.strictObject({ planId: idSchema })
export const applyPlanInputSchema = z.strictObject({ planId: idSchema, confirm: z.literal(true) })
export const snapshotInputSchema = z.strictObject({ reason: reasonSchema.optional() })
export const restoreInputSchema = z.strictObject({ snapshotId: idSchema, confirm: z.literal(true) })

export const confirmBodySchema = z.strictObject({ confirm: z.literal(true) })

/**
 * Same shapes, but `confirm` is accepted as anything so that a missing or non-`true` value
 * reaches `parseConfirmed` and is reported as `confirmation-required` instead of a generic
 * schema error. This is what MCP clients see in the tool's JSON schema.
 */
const confirmField = z
  .unknown()
  .optional()
  .describe('Must be the boolean true. Any other value is rejected with confirmation-required.')

export const applyPlanToolShape = z.strictObject({ planId: idSchema, confirm: confirmField })
export const restoreToolShape = z.strictObject({ snapshotId: idSchema, confirm: confirmField })
export const confirmBodyShape = z.strictObject({ confirm: confirmField })

/**
 * Checks `confirm` first, then validates the rest with the strict schema. A missing or non-`true`
 * `confirm` is always `confirmation-required`, whatever else is wrong with the input.
 */
export function parseConfirmed<S extends z.ZodType>(schema: S, input: unknown): Exact<z.output<S>> {
  const confirm = typeof input === 'object' && input !== null ? (input as Record<string, unknown>).confirm : undefined
  if (confirm !== true) {
    throw new KeyboardServiceError('confirmation-required', 'confirm must be the boolean true to run this action')
  }
  return parseInput(schema, input)
}

/**
 * Validates untrusted input. Returns the contract-shaped value: optional keys that were passed
 * as `undefined` are removed, so the result satisfies `exactOptionalPropertyTypes`.
 * Throws `KeyboardServiceError('validation')`.
 */
export function parseInput<S extends z.ZodType>(schema: S, input: unknown): Exact<z.output<S>> {
  const result = schema.safeParse(input)
  if (!result.success) throw validationError(zodIssues(result.error))
  return stripUndefined(result.data) as Exact<z.output<S>>
}

// ---------------------------------------------------------------------------
// Compile-time equivalence with the contract types
// ---------------------------------------------------------------------------

/** Removes the `| undefined` that zod adds to optional properties, recursively. */
export type Exact<T> = T extends readonly (infer U)[]
  ? Exact<U>[]
  : T extends object
    ? { [K in keyof T as undefined extends T[K] ? never : K]: Exact<T[K]> } & {
        [K in keyof T as undefined extends T[K] ? K : never]?: Exact<Exclude<T[K], undefined>>
      }
    : T

type Equal<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false
type Assert<T extends true> = T
type Infer<S extends z.ZodType> = Exact<z.output<S>>

export type SchemaContractChecks = [
  Assert<Equal<Infer<typeof layerSchema>, (typeof LAYERS)[number]>>,
  Assert<Equal<Infer<typeof modifiersSchema>, Modifier[]>>,
  Assert<Equal<Infer<typeof keyAssignmentSchema>, KeyAssignment>>,
  Assert<Equal<Infer<typeof macroStepSchema>, MacroStep>>,
  Assert<Equal<Infer<typeof macroSchema>, Macro>>,
  Assert<Equal<Infer<typeof keysPlanInputSchema>, KeysPlanInput>>,
  Assert<Equal<Infer<typeof macroPlanInputSchema>, MacroPlanInput>>,
  Assert<Equal<Infer<typeof lightingPlanInputSchema>, LightingPlanInput>>,
  Assert<Equal<Infer<typeof emptyInputSchema>, ToolContract['keyboard_status']['input']>>,
  Assert<Equal<Infer<typeof getConfigInputSchema>, ToolContract['keyboard_get_config']['input']>>,
  Assert<Equal<Infer<typeof previewPlanInputSchema>, ToolContract['keyboard_preview_plan']['input']>>,
  Assert<Equal<Infer<typeof applyPlanInputSchema>, ToolContract['keyboard_apply_plan']['input']>>,
  Assert<Equal<Infer<typeof snapshotInputSchema>, ToolContract['keyboard_snapshot']['input']>>,
  Assert<Equal<Infer<typeof restoreInputSchema>, ToolContract['keyboard_restore']['input']>>,
  Assert<Equal<Infer<typeof confirmBodySchema>, { confirm: true }>>,
]
