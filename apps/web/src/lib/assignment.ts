import type { KeyAssignment, KeyDefinition, KeyboardConfig, KeyboardLayout, Layer } from '@perifmcp/core'

export function labelForCode(code: string, layout: KeyboardLayout): string {
  return layout.keys.find((k) => k.id === code)?.label ?? code
}

/** Short cap text for an assignment. `undefined` means the key shows its own printed label. */
export function assignmentCapText(
  assignment: KeyAssignment | undefined,
  key: KeyDefinition,
  layout: KeyboardLayout,
  config: KeyboardConfig,
  layer: Layer,
): string | undefined {
  if (!assignment) return layer === 'base' ? undefined : '·'
  switch (assignment.kind) {
    case 'key': {
      const hasModifiers = (assignment.modifiers?.length ?? 0) > 0
      if (assignment.code === key.id && !hasModifiers) return undefined
      const mods = (assignment.modifiers ?? []).map((m) => m[0]?.toUpperCase() ?? '').join('')
      return `${mods ? `${mods}+` : ''}${labelForCode(assignment.code, layout)}`
    }
    case 'macro': {
      const macro = config.macros.find((m) => m.id === assignment.macroId)
      return `M:${macro?.name ?? assignment.macroId}`
    }
    case 'layer':
      return `→${assignment.layer}`
    case 'none':
      return '∅'
  }
}

/** Sentence for screen readers and tooltips. */
export function assignmentSentence(assignment: KeyAssignment | undefined, config: KeyboardConfig): string {
  if (!assignment) return 'not assigned on this layer'
  switch (assignment.kind) {
    case 'key':
      return `sends ${[...(assignment.modifiers ?? []), assignment.code].join('+')}`
    case 'macro': {
      const macro = config.macros.find((m) => m.id === assignment.macroId)
      return `runs macro ${macro?.name ?? assignment.macroId}`
    }
    case 'layer':
      return `switches to layer ${assignment.layer}`
    case 'none':
      return 'does nothing'
  }
}
