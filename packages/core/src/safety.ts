/**
 * Command safety policy for the vendor HID channel.
 *
 * Owner: master agent.
 *
 * Every transport connection that reaches real hardware must be wrapped with
 * `guardConnection`. The default mode is `read-only`, which only lets the identification
 * commands through. Enabling `read-write` is a deliberate decision of the master agent,
 * taken after the read-only probe has identified the model and the write path has tests.
 *
 * Command numbers come from docs/hardware.md and from the public GK6X reference tool.
 */
import type { HidConnection } from './transport.js'
import type { AccessMode } from './service.js'
import type { DeviceSummary } from './types.js'

interface CommandRule {
  command: number
  /** When omitted, any sub-command is accepted. */
  subCommands?: readonly number[]
}

/** Identification and keep-alive. Safe to send at any time. */
export const READ_ONLY_RULES: readonly CommandRule[] = [
  { command: 0x01, subCommands: [0x01, 0x02, 0x08, 0x09] }, // version, device id, model id, matrix
  { command: 0x0c }, // ping
]

/** Additional commands that change keyboard state. Only allowed in `read-write` mode. */
export const WRITE_RULES: readonly CommandRule[] = [
  { command: 0x0b }, // set active layer
  { command: 0x15 }, // key reporting / driver macro
  { command: 0x16 }, // driver key table
  { command: 0x17 }, // LE configuration
  { command: 0x1a }, // realtime lighting
  { command: 0x21 }, // clean data
  { command: 0x22 }, // write key data
  { command: 0x24 }, // write LE mode
  { command: 0x25 }, // write macro
  { command: 0x26 }, // write per-key lighting effect
  { command: 0x27 }, // write lighting data
  { command: 0x31 }, // write Fn data
]

/**
 * Never allowed, in any mode.
 * - 0x03: restart. Can reboot into the bootloader (CDBoot), which is the firmware update path.
 * - 0x41: USB VID/PID change (`writeMacVid`). Can make the keyboard identify as Apple hardware.
 */
export const FORBIDDEN_COMMANDS: readonly number[] = [0x03, 0x41]

function matches(rules: readonly CommandRule[], command: number, subCommand: number): boolean {
  return rules.some(
    (rule) => rule.command === command && (rule.subCommands === undefined || rule.subCommands.includes(subCommand)),
  )
}

export function isCommandAllowed(mode: AccessMode, command: number, subCommand: number): boolean {
  if (FORBIDDEN_COMMANDS.includes(command)) return false
  if (matches(READ_ONLY_RULES, command, subCommand)) return true
  return mode === 'read-write' && matches(WRITE_RULES, command, subCommand)
}

export class CommandNotAllowedError extends Error {
  constructor(
    readonly command: number,
    readonly subCommand: number,
    readonly mode: AccessMode,
  ) {
    super(
      `Command 0x${command.toString(16).padStart(2, '0')}/0x${subCommand.toString(16).padStart(2, '0')} is not allowed in ${mode} mode`,
    )
    this.name = 'CommandNotAllowedError'
  }
}

export interface GuardOptions {
  /** Defaults to `read-only`. */
  mode?: AccessMode
}

/** Wraps a connection so that packets outside the policy are rejected before they are sent. */
export function guardConnection(connection: HidConnection, options: GuardOptions = {}): HidConnection {
  const mode = options.mode ?? 'read-only'
  const guarded: HidConnection = {
    get info(): DeviceSummary {
      return connection.info
    },
    send(packet, timeoutMs) {
      const command = packet[0] ?? 0
      const subCommand = packet[1] ?? 0
      if (!isCommandAllowed(mode, command, subCommand)) {
        return Promise.reject(new CommandNotAllowedError(command, subCommand, mode))
      }
      return connection.send(packet, timeoutMs)
    },
    close() {
      return connection.close()
    },
  }
  if (connection.subscribe) {
    guarded.subscribe = connection.subscribe.bind(connection)
  }
  return guarded
}
