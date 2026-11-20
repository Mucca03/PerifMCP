/** Limits shared by the zod schemas (trust boundary) and the service (defense in depth). */

export const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/
/** Macro ids are echoed in diffs and tool output, so keep them to a plain charset. */
export const MACRO_ID_RE = /^[A-Za-z0-9_.-]+$/
/** Names are free text but must not contain control characters. */
// eslint-disable-next-line no-control-regex
export const CONTROL_CHARS_RE = /[\u0000-\u001f\u007f]/

export const MAX_MACRO_ID_LENGTH = 64
export const MAX_MACRO_NAME_LENGTH = 64
export const MAX_MACRO_STEPS = 256
export const MIN_MACRO_DELAY_MS = 0
export const MAX_MACRO_DELAY_MS = 60_000
export const MIN_MACRO_REPEAT = 1
export const MAX_MACRO_REPEAT = 1000
export const MAX_KEY_MODIFIERS = 4

export const MAX_REASON_LENGTH = 200
export const MAX_ID_LENGTH = 64

export const MAX_BODY_BYTES = 256 * 1024

export const PLAN_TTL_MS = 30 * 60 * 1000
export const MAX_PLANS = 100
