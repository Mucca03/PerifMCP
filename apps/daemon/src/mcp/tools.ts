import type { z } from 'zod'
import { PLANNING_TOOLS, READ_ONLY_TOOLS, WRITE_TOOLS } from '@perifmcp/core'
import type { KeyboardService, ToolContract, ToolName } from '@perifmcp/core'
import {
  applyPlanInputSchema,
  applyPlanToolShape,
  emptyInputSchema,
  getConfigInputSchema,
  keysPlanInputSchema,
  lightingPlanInputSchema,
  macroPlanInputSchema,
  parseConfirmed,
  parseInput,
  previewPlanInputSchema,
  restoreInputSchema,
  restoreToolShape,
  snapshotInputSchema,
} from '../schemas.js'

/**
 * One entry per tool in `ToolContract`. Typed as a mapped type over `ToolName`, so adding or
 * removing a tool without a matching entry fails to compile. Each tool calls one service method.
 */
export interface ToolDefinition<K extends ToolName> {
  title: string
  description: string
  /** Schema advertised to MCP clients and used by the SDK for a first validation pass. */
  inputSchema: z.ZodObject
  /** Strict validation (including the `confirm` rule). Throws `KeyboardServiceError`. */
  parse(raw: unknown): ToolContract[K]['input']
  run(service: KeyboardService, input: ToolContract[K]['input']): Promise<ToolContract[K]['output']>
  /** Short human-readable summary placed in the text content. */
  summarize(output: ToolContract[K]['output'], input: ToolContract[K]['input']): string
}

export type ToolRegistry = { [K in ToolName]: ToolDefinition<K> }

function count(value: number, noun: string): string {
  return `${value} ${noun}${value === 1 ? '' : 's'}`
}

export const TOOLS: ToolRegistry = {
  keyboard_status: {
    title: 'Keyboard status',
    description:
      'Connection state, access mode, whether writes are enabled (and why not), device info and the current config revision. Call this first.',
    inputSchema: emptyInputSchema,
    parse: (raw) => parseInput(emptyInputSchema, raw),
    run: (service) => service.status(),
    summarize: (out) =>
      `Keyboard ${out.connection} (${out.transport}), mode ${out.mode}. ` +
      (out.writeEnabled ? 'Writes are enabled.' : `Writes are disabled: ${out.writeDisabledReasons.join('; ')}.`),
  },
  keyboard_get_layout: {
    title: 'Keyboard layout',
    description: 'Physical layout: key ids, labels and positions. Use these key ids in plans.',
    inputSchema: emptyInputSchema,
    parse: (raw) => parseInput(emptyInputSchema, raw),
    run: (service) => service.getLayout(),
    summarize: (out) => `Layout ${out.name}: ${count(out.keyCount, 'key')}.`,
  },
  keyboard_get_config: {
    title: 'Get configuration',
    description: 'Whole keyboard configuration, or only the key assignments of one layer when `layer` is given.',
    inputSchema: getConfigInputSchema,
    parse: (raw) => parseInput(getConfigInputSchema, raw),
    run: async (service, input) =>
      input.layer === undefined
        ? service.getConfig()
        : { layer: input.layer, assignments: await service.getLayer(input.layer) },
    summarize: (out) =>
      'layers' in out
        ? `Configuration: ${count(out.macros.length, 'macro')}, lighting effect ${out.lighting.effect}.`
        : `Layer ${out.layer}: ${count(Object.keys(out.assignments).length, 'assignment')}.`,
  },
  keyboard_get_macros: {
    title: 'Get macros',
    description: 'Macros stored on the keyboard.',
    inputSchema: emptyInputSchema,
    parse: (raw) => parseInput(emptyInputSchema, raw),
    run: (service) => service.getMacros(),
    summarize: (out) => `${count(out.length, 'macro')}.`,
  },
  keyboard_get_lighting: {
    title: 'Get lighting',
    description: 'Current lighting state: effect, colors, brightness and speed (percent), per-key colors.',
    inputSchema: emptyInputSchema,
    parse: (raw) => parseInput(emptyInputSchema, raw),
    run: (service) => service.getLighting(),
    summarize: (out) => `Lighting ${out.enabled ? 'on' : 'off'}, effect ${out.effect}, brightness ${out.brightness}%.`,
  },

  keyboard_plan_keys: {
    title: 'Plan key remapping',
    description:
      'Create a plan that remaps keys on one layer. Does not touch the keyboard. Review it with keyboard_preview_plan, then apply it with keyboard_apply_plan.',
    inputSchema: keysPlanInputSchema,
    parse: (raw) => parseInput(keysPlanInputSchema, raw),
    run: (service, input) => service.planKeys(input),
    summarize: (out) => `Plan ${out.id}: ${out.summary}. ${count(out.changes.length, 'change')}, ${count(out.warnings.length, 'warning')}.`,
  },
  keyboard_plan_macro: {
    title: 'Plan macro',
    description:
      'Create a plan that adds or replaces a macro. Does not touch the keyboard. Review it with keyboard_preview_plan, then apply it with keyboard_apply_plan.',
    inputSchema: macroPlanInputSchema,
    parse: (raw) => parseInput(macroPlanInputSchema, raw),
    run: (service, input) => service.planMacro(input),
    summarize: (out) => `Plan ${out.id}: ${out.summary}. ${count(out.changes.length, 'change')}, ${count(out.warnings.length, 'warning')}.`,
  },
  keyboard_plan_lighting: {
    title: 'Plan lighting',
    description:
      'Create a plan that changes lighting (zones, per-key colors, base color, effect, brightness and speed in percent). Does not touch the keyboard. Review it with keyboard_preview_plan, then apply it with keyboard_apply_plan. Effects that can be written to a real keyboard today: off, solid, per-key and breathing. The other effects (rainbow, wave, reactive) make apply fail. Breathing uses the main color on every key unless the same request gives zone, base or per-key colors. The keyboard cannot be read back, so check the result by looking at it.',
    inputSchema: lightingPlanInputSchema,
    parse: (raw) => parseInput(lightingPlanInputSchema, raw),
    run: (service, input) => service.planLighting(input),
    summarize: (out) => `Plan ${out.id}: ${out.summary}. ${count(out.changes.length, 'change')}, ${count(out.warnings.length, 'warning')}.`,
  },
  keyboard_preview_plan: {
    title: 'Preview plan',
    description: 'Show what a plan would change: the diff, the affected keys and any warnings. Read-only.',
    inputSchema: previewPlanInputSchema,
    parse: (raw) => parseInput(previewPlanInputSchema, raw),
    run: (service, input) => service.previewPlan(input.planId),
    summarize: (out) =>
      `Plan ${out.plan.id}: ${count(out.diff.length, 'difference')}, ${count(out.affectedKeys.length, 'affected key')}, ${count(out.plan.warnings.length, 'warning')}.`,
  },
  keyboard_apply_plan: {
    title: 'Apply plan',
    description:
      'Write a plan to the keyboard. Requires confirm: true and writes enabled in keyboard_status. Takes a snapshot first, writes, reads back and verifies.',
    inputSchema: applyPlanToolShape,
    parse: (raw) => parseConfirmed(applyPlanInputSchema, raw),
    run: (service, input) => service.applyPlan(input.planId, input.confirm),
    summarize: (out) =>
      `Plan ${out.planId}: applied=${out.applied}, verified=${out.verified}` +
      (out.snapshotId === undefined ? '' : `, snapshot ${out.snapshotId}`) +
      (out.errors.length > 0 ? `. Errors: ${out.errors.join('; ')}` : '.'),
  },

  keyboard_verify: {
    title: 'Verify configuration',
    description: 'Read the keyboard back and compare it with what the last apply or restore wrote.',
    inputSchema: emptyInputSchema,
    parse: (raw) => parseInput(emptyInputSchema, raw),
    run: (service) => service.verify(),
    summarize: (out) => (out.ok ? 'Verified: no differences.' : `Verification failed: ${count(out.mismatches.length, 'difference')}.`),
  },

  keyboard_snapshot: {
    title: 'Take snapshot',
    description: 'Save the current keyboard configuration to a local snapshot that keyboard_restore can bring back.',
    inputSchema: snapshotInputSchema,
    parse: (raw) => parseInput(snapshotInputSchema, raw),
    run: (service, input) => service.snapshot(input.reason),
    summarize: (out) => `Snapshot ${out.id} saved (${out.reason}).`,
  },
  keyboard_list_snapshots: {
    title: 'List snapshots',
    description: 'Local snapshots of this keyboard, newest first.',
    inputSchema: emptyInputSchema,
    parse: (raw) => parseInput(emptyInputSchema, raw),
    run: (service) => service.listSnapshots(),
    summarize: (out) => `${count(out.length, 'snapshot')}.`,
  },
  keyboard_restore: {
    title: 'Restore snapshot',
    description:
      'Write a snapshot back to the keyboard. Requires confirm: true and writes enabled. Takes a safety snapshot of the current state first.',
    inputSchema: restoreToolShape,
    parse: (raw) => parseConfirmed(restoreInputSchema, raw),
    run: (service, input) => service.restore(input.snapshotId, input.confirm),
    summarize: (out) =>
      `Snapshot ${out.snapshotId}: applied=${out.applied}, verified=${out.verified}` +
      (out.safetySnapshotId === undefined ? '' : `, safety snapshot ${out.safetySnapshotId}`) +
      (out.errors.length > 0 ? `. Errors: ${out.errors.join('; ')}` : '.'),
  },
}

export const TOOL_NAMES: readonly ToolName[] = [...READ_ONLY_TOOLS, ...PLANNING_TOOLS, ...WRITE_TOOLS]

const READ_ONLY: ReadonlySet<string> = new Set([...READ_ONLY_TOOLS, ...PLANNING_TOOLS])

export function isReadOnlyTool(name: ToolName): boolean {
  return READ_ONLY.has(name)
}
