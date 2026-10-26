/** The published tool contract: names, schema parity, argument validation, rendering. */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createSuite } from './lib/harness.mjs'

const { bashToolDefinition, bashToolDescription, renderBashResult, withBashStatus } = await import('../lib/shells.js')
const { BASH_OUTPUT_SCHEMA } = await import('../lib/shells/tool.js')
const { BASH_ARGUMENTS, BASH_TOOL_NAME, DEFAULT_BASH_TIMEOUT_MS, DEFAULT_GRACE_MS, MAX_BASH_TIMEOUT_MS } = await import('../lib/shells/constants.js')
const { bashRefusalValue } = await import('../lib/session-shells.js')
const suite = createSuite('tool-contract')

const file = process.platform === 'win32'
  ? path.join(os.homedir(), '.dsh', 'dsh-bash', 'shells', 'bash', '0.0.0', 'bin', 'bash.exe')
  : '/bin/bash'
const definition = bashToolDefinition({ file, source: 'config' })

suite.test('the tool publishes under ops_bash', () => {
  assert.equal(definition.name, 'ops_bash')
  assert.equal(BASH_TOOL_NAME, 'ops_bash')
})

suite.test('the declared argument order matches the enforced list', () => {
  assert.deepEqual(Object.keys(definition.parameters.properties), [...BASH_ARGUMENTS])
  assert.deepEqual(BASH_ARGUMENTS, ['command', 'description', 'script_path', 'workdir', 'timeoutMs', 'graceMs', 'includeDiagnostics'])
})

suite.test('the argument schema forbids undeclared keys', () => {
  assert.equal(definition.parameters.type, 'object')
  assert.equal(definition.parameters.additionalProperties, false)
})

suite.test('every output-schema type is a single JSON type, never an array', () => {
  const walk = (node, where) => {
    if (node === null || typeof node !== 'object') return
    if ('type' in node) {
      assert.equal(typeof node.type, 'string', `${where}.type must be a single type`)
    }
    for (const [key, child] of Object.entries(node)) {
      if (key === 'properties') for (const [name, value] of Object.entries(child)) walk(value, `${where}.${name}`)
      else if (key === 'items') walk(child, `${where}[]`)
      else if (key === 'oneOf') child.forEach((value, index) => walk(value, `${where}|${index}`))
    }
  }
  walk(BASH_OUTPUT_SCHEMA, 'schema')
})

suite.test('the output schema requires the fields a refusal must carry', () => {
  for (const field of ['status', 'timedOut', 'timeoutMs', 'stdout', 'stderr']) {
    assert.ok(BASH_OUTPUT_SCHEMA.required.includes(field), `missing required ${field}`)
  }
})

suite.test('a complete command resolves to the executor spec', () => {
  assert.deepEqual(definition.resolve({ command: 'ls', description: 'list' }), {
    command: 'ls',
    scriptPath: undefined,
    workdir: undefined,
    timeoutMs: DEFAULT_BASH_TIMEOUT_MS,
    graceMs: DEFAULT_GRACE_MS,
    includeDiagnostics: false,
  })
})

suite.test('empty command / script_path strings are treated as absent', () => {
  const spec = definition.resolve({ command: 'ls', description: 'list', script_path: '' })
  assert.equal(spec.command, 'ls')
  assert.equal(spec.scriptPath, undefined)
})

suite.test('an empty workdir is refused here and normalised by the session layer', () => {
  // `ops_bash.execute` receives a workdir the session layer already resolved; an
  // empty string reaching this layer is a caller error, not a placeholder.
  assert.throws(() => definition.resolve({ command: 'ls', workdir: '' }), /must be an existing directory/)
})

suite.test('unknown arguments are refused, with the escalation explanation', () => {
  assert.throws(() => definition.resolve({ command: 'ls', run_in_background: true }), (error) => {
    assert.match(error.message, /unknown key "run_in_background"/)
    assert.match(error.message, /accepts command, description/)
    return true
  })
  assert.throws(() => definition.resolve({ command: 'ls', sandbox_permissions: 'workspace-write' }), /no per-call sandbox escalation/)
})

suite.test('exactly one of command or script_path is required', () => {
  assert.throws(() => definition.resolve({}), /exactly one of command or script_path/)
  assert.throws(() => definition.resolve({ command: '', script_path: '' }), /non-empty string|exactly one/)
  assert.throws(() => definition.resolve({ command: 'ls', script_path: 'x.sh' }), /exactly one/)
  assert.doesNotThrow(() => definition.resolve({ command: 'ls' }))
})

suite.test('argument types are checked field by field', () => {
  assert.throws(() => definition.resolve({ command: 1 }), /invalid command: expected a string/)
  assert.throws(() => definition.resolve({ command: 'ls', description: 1 }), /invalid description/)
  assert.throws(() => definition.resolve({ command: 'ls', workdir: 1 }), /invalid workdir: expected a string/)
  assert.throws(() => definition.resolve({ command: 'ls', includeDiagnostics: 'yes' }), /invalid includeDiagnostics/)
  assert.throws(() => definition.resolve('ls'), /expected an object/)
})

suite.test('timeouts are positive, finite and bounded', () => {
  for (const value of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, '100']) {
    assert.throws(() => definition.resolve({ command: 'ls', timeoutMs: value }), /invalid timeoutMs/)
  }
  assert.throws(() => definition.resolve({ command: 'ls', timeoutMs: MAX_BASH_TIMEOUT_MS + 1 }), /no greater than/)
  assert.throws(() => definition.resolve({ command: 'ls', graceMs: 0 }), /invalid graceMs/)
})

suite.test('a workdir must be an existing directory', () => {
  const missing = path.join(os.tmpdir(), 'dsh-bash-does-not-exist-dir')
  assert.throws(() => definition.resolve({ command: 'ls', workdir: missing }), /must be an existing directory/)
  assert.doesNotThrow(() => definition.resolve({ command: 'ls', workdir: os.tmpdir() }))
})

suite.test('includeDiagnostics is carried through, not converted', () => {
  assert.equal(definition.resolve({ command: 'ls', includeDiagnostics: true }).includeDiagnostics, true)
})

suite.test('rendered markers name the outcome the caller must read', () => {
  const base = { timedOut: false, timeoutMs: 1000, stdout: { text: 'out', truncated: false }, stderr: { text: '', truncated: false } }
  assert.equal(renderBashResult(base), 'out')
  assert.match(renderBashResult({ ...base, exitCode: 3 }), /\[exit code: 3\]$/)
  assert.match(renderBashResult({ ...base, timedOut: true }), /\[timed out after 1000ms\]/)
  assert.match(renderBashResult({ ...base, cancelled: true }), /\[cancelled\]/)
  assert.match(renderBashResult({ ...base, signal: 'SIGKILL' }), /\[signal: SIGKILL\]/)
  assert.match(renderBashResult({ ...base, stderr: { text: 'bad', truncated: false } }), /^out\n\[stderr\]\nbad/)
  assert.match(renderBashResult({ ...base, stdout: { text: 'x', truncated: true, spillPath: 'C:/spill.log' } }), /full output: C:\/spill\.log/)
  assert.equal(renderBashResult({ ...base, stdout: { text: '', truncated: false } }), '(no output)')
})

suite.test('status is completed only for a clean zero exit', () => {
  const base = { timedOut: false, timeoutMs: 1000, stdout: { text: '', truncated: false }, stderr: { text: '', truncated: false } }
  assert.equal(withBashStatus({ ...base, exitCode: 0 }).status, 'completed')
  for (const variant of [{ exitCode: 1 }, { exitCode: 0, stderr: { text: 'warn', truncated: false } , signal: 'SIGTERM' }, { exitCode: 0, timedOut: true }, { exitCode: 0, cancelled: true }, { exitCode: 0, error: 'boom' }]) {
    assert.equal(withBashStatus({ ...base, ...variant }).status, 'failed')
  }
})

suite.test('the refusal value satisfies the registered output schema', () => {
  const value = bashRefusalValue(new Error('boom'))
  assert.equal(value.timedOut, false)
  assert.equal(value.timeoutMs, DEFAULT_BASH_TIMEOUT_MS)
  assert.equal(value.stdout.text, '')
  assert.equal(value.stderr.text, '')
  assert.equal(value.error, 'boom')
})

suite.test('the description states the rung and the recovery rule', () => {
  const text = bashToolDescription()
  assert.match(text, /prefer this command executor over PowerShell/)
  assert.match(text, /do not switch shells/)
  assert.match(text, /script_path/)
})

suite.test('the definition imports no host package at runtime', () => {
  const source = fs.readFileSync(path.resolve(import.meta.dirname, '../lib/shells/tool.js'), 'utf8')
  assert.equal(/from '@deepseek-ai\//.test(source), false)
})

await suite.run()
