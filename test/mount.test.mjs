/** Mount lifecycle: what the component publishes, and how it withdraws it. */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHost, createSubprocess } from './lib/host.mjs'
import { createSuite } from './lib/harness.mjs'

const { apply } = await import('../lib/components/shell/index.js')
const { resolveShells } = await import('../lib/shells.js')
const { resolveConfig } = await import('../lib/config.js')
const suite = createSuite('mount')

const bash = resolveShells(resolveConfig({})).bash
const hasBash = bash.available === true
const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-bash-mount-'))

const tick = (ms = 150) => new Promise(resolve => setTimeout(resolve, ms))

/**
 * Mount the real component entry, create one agent, and let reconciliation settle.
 * `options.countSpawns` wraps the subprocess service so a case can prove that no
 * command was started.
 */
async function mount({ config = {}, host: provided, countSpawns = false } = {}) {
  let spawns = 0
  const subprocess = createSubprocess()
  if (countSpawns) {
    const original = subprocess.spawn
    subprocess.spawn = (...args) => { spawns++; return original(...args) }
  }
  const host = provided ?? createHost({ workspaceRoot, subprocess })
  apply(host.ctx, config)
  const agent = host.makeAgent({ id: 'session-mount', header: { cwd: workspaceRoot } })
  await host.emit('agent/created', { agent })
  await tick()
  return { host, agent, spawns: () => spawns, definition: () => agent.registrations.find(item => item.name === 'ops_bash') }
}

suite.test('mounting registers one prompt section and nothing else', async () => {
  const { host } = await mount()
  assert.equal(host.sections.length, 1)
  assert.equal(host.sections[0].name, 'dsh-bash:shell-routing')
  assert.equal(host.sections[0].order, 3251)
  assert.equal(host.sections[0].interpolate, false)
})

suite.test('the agent gets exactly one ops_bash registration', { skip: !hasBash }, async () => {
  const { agent } = await mount()
  assert.deepEqual(agent.registrations.map(item => item.name), ['ops_bash'])
})

suite.test('the published definition carries the host argument surface', { skip: !hasBash }, async () => {
  const { definition } = await mount()
  const properties = Object.keys(definition().parameters.properties)
  for (const name of ['command', 'description', 'script_path', 'workdir', 'timeoutMs', 'sandbox_permissions', 'justification']) {
    assert.ok(properties.includes(name), `missing ${name}`)
  }
  assert.deepEqual(definition().parameters.required, ['description'])
})

suite.test('the routing section advertises ops_bash for this agent', { skip: !hasBash }, async () => {
  const { host, agent } = await mount()
  const text = host.sections[0].text({ agent })
  assert.match(text, /ops_bash/)
  assert.match(text, /Shell routing/)
})

suite.test('the mounted tool runs a real command', { skip: !hasBash }, async () => {
  const { definition, agent } = await mount()
  const value = await definition().execute({ command: 'echo mount-ok', description: 'mount smoke' }, { agent, callId: 'm1' })
  assert.equal(value.kind, 'foreground')
  assert.equal(value.exitCode, 0)
  assert.equal(value.stdout.text.trim(), 'mount-ok')
  assert.equal(value.status, 'completed')
})

suite.test('a failing command returns the host failure shape instead of throwing', { skip: !hasBash }, async () => {
  const { definition, agent } = await mount()
  const value = await definition().execute({ command: 'exit 7', description: 'failure' }, { agent })
  assert.equal(value.kind, 'foreground')
  assert.equal(value.exitCode, 7)
  assert.equal(value.status, 'failed')
  assert.equal(value.failure.code, 'EXIT_CODE')
  assert.equal(value.failure.retry, 'after-input-change')
  assert.match(value.failure.nextAction, /Inspect the exit code/)
})

suite.test('an undeclared argument is refused before any process starts', { skip: !hasBash }, async () => {
  const { definition, agent, spawns } = await mount({ countSpawns: true })
  const value = await definition().execute({ command: 'echo x', description: 'x', run_in_background: true }, { agent })
  assert.equal(value.status, 'failed')
  assert.equal(value.failure.code, 'INVALID_BASH_ARGUMENT')
  assert.equal(value.failure.effectState, 'none')
  assert.equal(spawns(), 0)
})

suite.test('a narrower per-call sandbox request is refused', { skip: !hasBash }, async () => {
  const { definition, agent } = await mount()
  const value = await definition().execute({ command: 'echo x', description: 'x', sandbox_permissions: 'read-only' }, { agent })
  assert.equal(value.status, 'failed')
  assert.match(value.failure.code, /INVALID_BASH_ARGUMENT/)
})

suite.test('an escalation the user refuses never starts a command', { skip: !hasBash }, async () => {
  const host = createHost({ workspaceRoot, mode: 'workspace-write', approvalOutcome: 'rejected' })
  const { definition, agent, spawns } = await mount({ host, countSpawns: true })
  const value = await definition().execute({
    command: 'echo x', description: 'escalate', sandbox_permissions: 'danger-full-access', justification: 'needs a system path',
  }, { agent })
  assert.equal(value.status, 'failed')
  assert.match(value.failure.message, /APPROVAL_REJECTED/)
  assert.equal(spawns(), 0)
})

suite.test('a granted escalation runs with the widened policy', { skip: !hasBash || process.platform === 'win32' }, async () => {
  // On Windows a restricted session needs the verified MSYS IPC runtime; this case
  // only has meaning where confinement is available without it.
  const host = createHost({ workspaceRoot, mode: 'workspace-write', approvalOutcome: 'allowed-once' })
  const { definition, agent } = await mount({ host })
  const value = await definition().execute({
    command: 'echo widened', description: 'escalate', sandbox_permissions: 'danger-full-access', justification: 'needs a system path',
  }, { agent })
  assert.equal(value.exitCode, 0)
  assert.equal(value.stdout.text.trim(), 'widened')
  assert.equal(value.sandbox.mode, 'danger-full-access')
})

suite.test('run_in_background is only declared when the host publishes jobs', { skip: !hasBash }, async () => {
  const withJobs = await mount({ host: createHost({ workspaceRoot, jobs: { start: () => 'job-1' } }) })
  assert.ok('run_in_background' in withJobs.definition().parameters.properties)
  const withoutJobs = await mount()
  assert.equal('run_in_background' in withoutJobs.definition().parameters.properties, false)
})

suite.test('losing the authority withdraws the tool', { skip: !hasBash }, async () => {
  const { host, agent } = await mount()
  assert.equal(agent.registrations.length, 1)
  host.setMode('read-only')
  host.removeService('sandbox')
  await host.emit('session/event', agent.session, { type: 'sandbox/mode' })
  await tick()
  assert.deepEqual(agent.registrations, [])
})

suite.test('disposing the agent withdraws the tool', { skip: !hasBash }, async () => {
  const { host, agent } = await mount()
  assert.equal(agent.registrations.length, 1)
  await host.emit('agent/disposed', { agent })
  await tick()
  assert.deepEqual(agent.registrations, [])
})

suite.test('publishBashTool:false mounts nothing but keeps the prompt honest', async () => {
  const { host, agent } = await mount({ config: { publishBashTool: false } })
  assert.deepEqual(agent.registrations, [])
  const text = host.sections[0].text({ agent })
  assert.equal(text, '')
})

suite.test('promptPolicy:false publishes no routing section', async () => {
  const { host } = await mount({ config: { promptPolicy: false } })
  assert.deepEqual(host.sections, [])
})

suite.test('an unusable bashPath mounts no tool and does not throw', async () => {
  const { host, agent } = await mount({ config: { bashPath: path.join(workspaceRoot, 'nope', 'bash.exe') } })
  assert.deepEqual(agent.registrations, [])
  assert.equal(host.sections.length, 1)
})

suite.test('deny-host-shell hides and refuses the host shell tools', { skip: !hasBash }, async () => {
  const { host, agent } = await mount({ config: { shellPolicy: 'deny-host-shell' } })
  // Seed the agent's surface with the host tools the policy denies, then re-hide.
  agent.registrations.push({ name: 'bash' }, { name: 'pwsh' }, { name: 'pwsh_persistent' })
  await host.emit('agent/created', { agent })
  await tick()
  const denied = host.restrictions.flatMap(item => item.deny ?? [])
  for (const name of ['bash', 'pwsh', 'pwsh_persistent']) assert.ok(denied.includes(name), `not denied: ${name}`)
  const refusal = await host.emit('tools/pre-execute', { name: 'pwsh' }, async () => 'allowed')
  assert.equal(refusal.kind, 'deny')
  assert.match(refusal.reason, /disabled by dsh-bash shellPolicy/)
  const allowed = await host.emit('tools/pre-execute', { name: 'read_file' }, async () => 'allowed')
  assert.equal(allowed, 'allowed')
})

suite.test('advise keeps the host shell tools untouched', { skip: !hasBash }, async () => {
  const { host, agent } = await mount()
  agent.registrations.push({ name: 'bash' })
  await host.emit('agent/created', { agent })
  await tick()
  assert.deepEqual(host.restrictions, [])
  // No pre-execute hook at all in advise mode: the call passes through untouched.
  assert.equal(host.handlers.get('tools/pre-execute'), undefined)
  assert.equal(await host.emit('tools/pre-execute', { name: 'bash' }, async () => 'allowed'), undefined)
})

await suite.run()
fs.rmSync(workspaceRoot, { recursive: true, force: true })
