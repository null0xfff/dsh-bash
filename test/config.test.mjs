/** Configuration contract: defaults, loud failures, and dsh-ops row compatibility. */
import assert from 'node:assert/strict'
import { createSuite } from './lib/harness.mjs'

const { resolveConfig, ConfigError, CORE_CONFIG_KEYS, DEFAULT_DENIED_HOST_TOOLS } = await import('../lib/config.js')
const suite = createSuite('config')

suite.test('an empty row resolves to the documented defaults', () => {
  const config = resolveConfig({})
  assert.deepEqual(config, {
    configUpdateVersion: 0,
    shellPolicy: 'advise',
    deniedHostTools: [...DEFAULT_DENIED_HOST_TOOLS],
    promptPolicy: true,
    extraGuidance: '',
    bashPath: undefined,
    publishBashTool: true,
    allowSystemShellFallback: false,
  })
})

suite.test('undefined and null rows behave like an empty row', () => {
  assert.deepEqual(resolveConfig(undefined), resolveConfig({}))
  assert.deepEqual(resolveConfig(null), resolveConfig({}))
})

suite.test('a non-object row is refused', () => {
  assert.throws(() => resolveConfig([]), ConfigError)
  assert.throws(() => resolveConfig('bash'), /config must be an object/)
})

suite.test('an unknown key fails loud and names itself', () => {
  assert.throws(() => resolveConfig({ bashPathh: 'x' }), (error) => {
    assert.ok(error instanceof ConfigError)
    assert.match(error.message, /"bashPathh"/)
    assert.match(error.message, /accepted keys are/)
    return true
  })
})

suite.test('every accepted key is listed in CORE_CONFIG_KEYS', () => {
  const row = {}
  for (const key of CORE_CONFIG_KEYS) {
    if (key === 'serverName') row[key] = 'ops'
    else if (key === 'enableShellTools') row[key] = true
    else if (key === 'toolCallTimeoutMs') row[key] = 1000
    else if (key === 'shellPolicy') row[key] = 'advise'
    else if (key === 'deniedHostTools') row[key] = ['pwsh']
    else if (key === 'extraGuidance') row[key] = 'note'
    else if (key === 'bashPath') row[key] = 'C:/bin/bash.exe'
    else if (key === 'configUpdateVersion') row[key] = 2
    else row[key] = true
  }
  assert.doesNotThrow(() => resolveConfig(row))
})

suite.test('legacy dsh-ops keys are validated then dropped', () => {
  const config = resolveConfig({ serverName: 'ops_1', enableShellTools: false, toolCallTimeoutMs: 500 })
  for (const key of ['serverName', 'enableShellTools', 'toolCallTimeoutMs']) assert.equal(key in config, false)
})

suite.test('a malformed legacy value still fails loud', () => {
  assert.throws(() => resolveConfig({ serverName: 'bad name!' }), /serverName must match/)
  assert.throws(() => resolveConfig({ enableShellTools: 'yes' }), /enableShellTools must be a boolean/)
  assert.throws(() => resolveConfig({ toolCallTimeoutMs: 0 }), /toolCallTimeoutMs must be a positive finite number/)
  assert.throws(() => resolveConfig({ toolCallTimeoutMs: 2 ** 40 }), /toolCallTimeoutMs/)
})

suite.test('shellPolicy accepts only the two implemented values', () => {
  assert.equal(resolveConfig({ shellPolicy: 'deny-host-shell' }).shellPolicy, 'deny-host-shell')
  for (const value of ['deny', 'off', '']) assert.throws(() => resolveConfig({ shellPolicy: value }), ConfigError)
  assert.throws(() => resolveConfig({ shellPolicy: 1 }), /shellPolicy must be a non-empty string/)
})

suite.test('deniedHostTools is a list of non-empty strings', () => {
  assert.deepEqual(resolveConfig({ deniedHostTools: [] }).deniedHostTools, [])
  assert.throws(() => resolveConfig({ deniedHostTools: 'pwsh' }), /array of non-empty strings/)
  assert.throws(() => resolveConfig({ deniedHostTools: ['pwsh', ' '] }), /array of non-empty strings/)
})

suite.test('empty or non-string scalars are refused where a value is required', () => {
  assert.throws(() => resolveConfig({ bashPath: '' }), /bashPath must be a non-empty string/)
  assert.throws(() => resolveConfig({ bashPath: 42 }), /bashPath must be a non-empty string/)
  assert.throws(() => resolveConfig({ extraGuidance: ' ' }), /extraGuidance must be a non-empty string/)
})

suite.test('booleans are strictly typed', () => {
  for (const key of ['publishBashTool', 'promptPolicy', 'allowSystemShellFallback']) {
    assert.throws(() => resolveConfig({ [key]: 1 }), new RegExp(`${key} must be a boolean`))
  }
})

suite.test('configUpdateVersion is a non-negative safe integer', () => {
  assert.equal(resolveConfig({ configUpdateVersion: 3 }).configUpdateVersion, 3)
  for (const value of [-1, 1.5, '2']) assert.throws(() => resolveConfig({ configUpdateVersion: value }))
})

suite.test('the resolved object is a fresh copy, not the caller row', () => {
  const row = { deniedHostTools: ['pwsh'] }
  const config = resolveConfig(row)
  config.deniedHostTools.push('extra')
  assert.deepEqual(row.deniedHostTools, ['pwsh'])
})

await suite.run()
