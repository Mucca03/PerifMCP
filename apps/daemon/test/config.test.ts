import { describe, expect, it } from 'vitest'
import { DEFAULT_DAEMON_PORT } from '@perifmcp/core'
import { ConfigError, DEFAULT_ALLOWED_ORIGINS, defaultStateDir, loadConfig, parseOrigins } from '../src/config.js'

describe('loadConfig', () => {
  it('defaults to the mock backend, loopback, port 6465, writes off and the repo profiles folder', () => {
    const config = loadConfig({})
    expect(config).toEqual({
      host: '127.0.0.1',
      port: DEFAULT_DAEMON_PORT,
      allowedOrigins: [...DEFAULT_ALLOWED_ORIGINS],
      stateDir: defaultStateDir(),
      allowWrites: false,
      backend: 'mock',
      modelsFile: undefined,
    })
    expect(config.stateDir.endsWith('/profiles/local')).toBe(true)
  })

  it('enables writes only for the exact value 1', () => {
    for (const value of ['0', 'true', 'yes', '', ' 1', '2']) {
      expect(loadConfig({ PERIFMCP_ALLOW_WRITES: value }).allowWrites, value).toBe(false)
    }
    expect(loadConfig({ PERIFMCP_ALLOW_WRITES: '1' }).allowWrites).toBe(true)
  })

  it('validates the port and the backend', () => {
    expect(loadConfig({ PERIFMCP_PORT: '7000' }).port).toBe(7000)
    for (const port of ['0', '65536', 'abc', '12.5', '-1']) {
      expect(() => loadConfig({ PERIFMCP_PORT: port }), port).toThrow(ConfigError)
    }
    expect(loadConfig({ PERIFMCP_BACKEND: 'hid' }).backend).toBe('hid')
    expect(() => loadConfig({ PERIFMCP_BACKEND: 'usb' })).toThrow(ConfigError)
  })

  it('does not let the environment change the bind address', () => {
    expect(loadConfig({ PERIFMCP_HOST: '0.0.0.0', HOST: '0.0.0.0' }).host).toBe('127.0.0.1')
  })
})

describe('parseOrigins', () => {
  it('parses a comma-separated list into exact origins', () => {
    expect(parseOrigins('http://localhost:3000, https://ui.example/')).toEqual(['http://localhost:3000', 'https://ui.example'])
  })

  it('rejects wildcards, paths and other schemes', () => {
    for (const value of ['*', 'http://*', 'http://localhost:3000/app', 'ftp://localhost', 'localhost:3000', 'not a url']) {
      expect(() => parseOrigins(value), value).toThrow(ConfigError)
    }
  })
})
