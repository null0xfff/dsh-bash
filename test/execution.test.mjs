/** Execution: real commands through the host subprocess seam, and the session authority gate. */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { EventEmitter } from 'node:events'
import { createHost, createSubprocess } from './lib/host.mjs'
import { createSuite } from './lib/harness.mjs'

const { resolveShells, bashToolDefinition, renderBashResult, DEFAULT_GRACE_MS } = await import('../lib/shells.js')
const { shellEnvOverrides } = await import('../lib/shells/constants.js')
const { resolveConfig } = await import('../lib/config.js')
const { sessionWorkdir } = await import('../lib/session-shells.js')
const { startSessionBash } = await import('../lib/shells/session-execution.js')
const suite = createSuite('execution')

const resolved = resolveShells(resolveConfig({}))
const bash = resolved.bash
const hasBash = bash.available === true
if (!hasBash) console.log(`note: no bash resolvable here (${bash.detail}); command cases are skipped`)

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-bash-exec-'))

const hostFor = (mode = 'danger-full-access', extra = {}) => createHost({ mode, workspaceRoot: scratch, ...extra })
const policyFor = (mode) => ({ mode, workspaceRoot: scratch })
const run = (args, { host = hostFor(), mode = host.state.mode, exec } = {}) => {
  const policy = policyFor(mode)
  const call = exec ?? { agent: { session: { id: 's1', header: { cwd: scratch } } }, callId: 'c1' }
  return startSessionBash({ ctx: host.ctx, bash: { file: bash.file, source: bash.source }, active: () => true },
    args, call, policy, policy, {}, {}).result()
}

// Inject only the process boundary so stdin failures are deterministic on every OS,
// including hosts without bash. Errors must reach the shim's actual end() call.
function subprocessWithStdinError(error, { deferred = false } = {}) {
  const child = new EventEmitter()
  child.stdin = new EventEmitter()
  child.stdout = new EventEmitter()
  child.stderr = new EventEmitter()
  let endArgs
  child.stdin.end = (...args) => {
    endArgs = args
    const fail = () => child.stdin.emit('error', error)
    if (deferred) process.nextTick(fail)
    else fail()
  }
  const subprocess = createSubprocess({ spawnChild: () => child })
  return { subprocess, child, endArgs: () => endArgs }
}

suite.test('stdin EPIPE/EOF during or after end keeps the real child outcome', async () => {
  for (const code of ['EPIPE', 'EOF']) {
    const brokenPipe = Object.assign(new Error(`write ${code}`), { code })
    for (const deferred of [false, true]) {
      for (const outcome of [{ exitCode: 0, signal: null }, { exitCode: 7, signal: null }, { exitCode: null, signal: 'SIGTERM' }]) {
        const { subprocess, child, endArgs } = subprocessWithStdinError(brokenPipe, { deferred })
        const handle = subprocess.spawn({ argv: ['fake'], stdio: { stdin: { data: '' } } })
        assert.deepEqual(endArgs(), [], 'empty input must close stdin without writing an empty chunk')
        let settled = false
        void handle.done.then(() => { settled = true }, () => { settled = true })
        await new Promise(resolve => setImmediate(resolve))
        assert.equal(settled, false, `${code} must not settle the process before close`)
        child.emit('close', outcome.exitCode, outcome.signal)
        assert.deepEqual(await handle.done, outcome)
      }
    }
  }
})

suite.test('unexpected stdin errors reject done rather than disappearing', async () => {
  const error = Object.assign(new Error('stdin device failed'), { code: 'EIO' })
  const { subprocess, child, endArgs } = subprocessWithStdinError(error)
  const handle = subprocess.spawn({ argv: ['fake'], stdio: { stdin: { data: 'input' } } })
  assert.deepEqual(endArgs(), ['input'])
  await assert.rejects(handle.done, value => value === error)
  child.emit('close', 0, null)
})

suite.test('a spawn failure stays visible even if stdin also reports EPIPE', async () => {
  const { subprocess, child } = subprocessWithStdinError(Object.assign(new Error('write EPIPE'), { code: 'EPIPE' }))
  const handle = subprocess.spawn({ argv: ['fake'] })
  const error = Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' })
  child.emit('error', error)
  await assert.rejects(handle.done, value => value === error)
  child.emit('close', -2, null)
})

async function nodeSubprocess(script, input) {
  const subprocess = createSubprocess()
  const handle = subprocess.spawn({
    argv: [process.execPath, '-e', script],
    stdio: { stdin: { data: input } },
  })
  let timedOut = false
  const timer = setTimeout(() => { timedOut = true; handle.kill() }, 10_000)
  try {
    const outcome = await handle.done
    assert.equal(timedOut, false, 'stdin regression child must settle before the watchdog')
    return { outcome, stdout: handle.collected.stdout.readFrom(0).text }
  } finally {
    clearTimeout(timer)
  }
}

suite.test('a real child that does not read a large stdin still reports its exit', async () => {
  for (const exitCode of [0, 7]) {
    const { outcome } = await nodeSubprocess(`process.exit(${exitCode})`, 'x'.repeat(4 * 1024 * 1024))
    assert.deepEqual(outcome, { exitCode, signal: null })
  }
})

suite.test('a real stdin reader receives the exact input and EOF', async () => {
  for (const input of [undefined, '', 'stdin payload\n']) {
    const { outcome, stdout } = await nodeSubprocess("process.stdin.pipe(process.stdout)", input)
    assert.deepEqual(outcome, { exitCode: 0, signal: null })
    assert.equal(stdout, input ?? '')
  }
})

suite.test('stdout, stderr and the exit code are reported separately', { skip: !hasBash }, async () => {
  const value = await run({ command: 'printf out; printf err >&2; exit 3', description: 'streams' })
  assert.equal(value.exitCode, 3)
  assert.equal(value.stdout.text, 'out')
  assert.equal(value.stderr.text, 'err')
  assert.equal(value.status, 'failed')
})

suite.test('the child gets a closed stdin instead of an inherited console', { skip: !hasBash }, async () => {
  const started = Date.now()
  const value = await run({ command: 'cat', description: 'closed stdin' })
  assert.equal(value.exitCode, 0)
  assert.equal(value.stdout.text, '')
  assert.ok(Date.now() - started < 10_000)
})

suite.test('script_path runs a file through bash, whatever its extension', { skip: !hasBash }, async () => {
  const file = path.join(scratch, 'script.txt')
  fs.writeFileSync(file, 'printf "from-script"\n')
  const value = await run({ script_path: file, description: 'script file' })
  assert.equal(value.exitCode, 0)
  assert.equal(value.stdout.text, 'from-script')
})

suite.test('an explicit workdir is the child cwd', { skip: !hasBash }, async () => {
  // MSYS prints its own mount spelling for \pwd\; \pwd -W\ answers the Windows path.
  const value = await run({ command: process.platform === 'win32' ? 'pwd -W' : 'pwd', description: 'cwd', workdir: scratch })
  assert.equal(value.exitCode, 0)
  assert.equal(fs.realpathSync.native(value.stdout.text.trim()), fs.realpathSync.native(scratch))
})

suite.test('the terminal overrides reach the child', { skip: !hasBash }, async () => {
  const value = await run({ command: 'printf "%s|%s|%s" "$NO_COLOR" "$TERM" "$PAGER"', description: 'env' })
  assert.equal(value.stdout.text, '1|dumb|cat')
})

suite.test('expiry kills the command instead of waiting for it', { skip: !hasBash }, async () => {
  const started = Date.now()
  const value = await run({ command: 'sleep 5', description: 'timeout', timeoutMs: 300 })
  const elapsed = Date.now() - started
  assert.equal(value.timedOut, true)
  assert.equal(value.timeoutMs, 300)
  assert.notEqual(value.exitCode, 0)
  assert.ok(elapsed < 4_000, `took ${elapsed}ms`)
})

suite.test('caller cancellation is reported as cancelled, not as a timeout', { skip: !hasBash }, async () => {
  const controller = new AbortController()
  const host = hostFor()
  const exec = { agent: { session: { id: 's1', header: { cwd: scratch } } }, callId: 'c2', signal: controller.signal }
  const running = startSessionBash({ ctx: host.ctx, bash: { file: bash.file, source: bash.source }, active: () => true },
    { command: 'sleep 5', description: 'cancel' }, exec, policyFor('danger-full-access'), policyFor('danger-full-access'), {}, {})
  setTimeout(() => controller.abort(new Error('user cancelled')), 100)
  const value = await running.result()
  assert.equal(value.cancelled, true)
  assert.notEqual(value.timedOut, true)
})

suite.test('bounded capture keeps an honest truncation flag and a spill path', { skip: !hasBash }, async () => {
  const host = hostFor('danger-full-access', { subprocess: createSubprocess({ maxBytes: 8 }) })
  const definition = bashToolDefinition({ file: bash.file ?? '/bin/bash', source: 'config', subprocess: host.subprocess })
  const value = await definition.execute({ command: 'printf 0123456789abcdef', description: 'truncation' }, {})
  assert.equal(value.stdout.text.length, 8)
  assert.equal(value.stdout.truncated, true)
  assert.ok(typeof value.stdout.spillPath === 'string' && fs.existsSync(value.stdout.spillPath))
  assert.match(renderBashResult(value), /output truncated; full output:/)
})

suite.test('diagnostics are opt-in and carry a duration and executor source', { skip: !hasBash }, async () => {
  const value = await run({ command: 'printf x', description: 'diag', includeDiagnostics: true })
  assert.ok(value.diagnostics && typeof value.diagnostics.durationMs === 'number')
  assert.equal(value.diagnostics.executor.kind, 'subprocess')
  assert.equal(value.diagnostics.executor.source, bash.source)
  const plain = await run({ command: 'printf x', description: 'no diag' })
  assert.equal(plain.diagnostics, undefined)
})

suite.test('a command that cannot start reports an executor failure, not a policy denial', async () => {
  const definition = bashToolDefinition({ file: path.join(scratch, 'missing-bash.exe'), source: 'config', subprocess: createSubprocess() })
  const value = await definition.execute({ command: 'printf x', description: 'missing binary' }, {})
  assert.equal(value.status, 'failed')
  assert.match(renderBashResult(value), /error:/)
})

suite.test('danger-full-access spawns the resolved bash without asking for confinement', { skip: !hasBash }, async () => {
  let confined = 0
  const host = hostFor()
  const original = host.services.sandbox.confine
  host.services.sandbox.confine = async (...args) => { confined++; return original(...args) }
  const value = await run({ command: 'printf free', description: 'unconfined' }, { host })
  assert.equal(value.stdout.text, 'free')
  assert.equal(confined, 0)
})

suite.test('a restricted session refuses instead of running unconfined', { skip: !hasBash }, () => {
  // On Windows a confined call needs the verified MSYS IPC runtime; without the
  // receipt the session layer refuses before spawning. On POSIX it runs.
  const host = hostFor('workspace-write')
  const policy = policyFor('workspace-write')
  if (process.platform === 'win32') {
    assert.throws(() => startSessionBash({ ctx: host.ctx, bash: { file: bash.file, source: bash.source }, active: () => true },
      { command: 'printf x', description: 'restricted' }, { agent: { session: { id: 's1', header: { cwd: scratch } } } }, policy, policy, {}, {}),
    /EXECUTOR_UNAVAILABLE/)
  } else {
    assert.doesNotThrow(() => startSessionBash({ ctx: host.ctx, bash: { file: bash.file, source: bash.source }, active: () => true },
      { command: 'printf x', description: 'restricted' }, { agent: { session: { id: 's1', header: { cwd: scratch } } } }, policy, policy, {}, {}))
  }
})

suite.test('a revoked authority is refused synchronously', { skip: !hasBash }, () => {
  const host = hostFor()
  const policy = policyFor('danger-full-access')
  assert.throws(() => startSessionBash({ ctx: host.ctx, bash: { file: bash.file, source: bash.source }, active: () => false },
    { command: 'printf x', description: 'inactive' }, { agent: { session: { id: 's1', header: { cwd: scratch } } } }, policy, policy, {}, {}),
  /AUTHORITY_CHANGED/)
})

suite.test('a changed session mode between start and spawn is refused', { skip: !hasBash }, async () => {
  const host = hostFor()
  const policy = policyFor('danger-full-access')
  const executing = startSessionBash({ ctx: host.ctx, bash: { file: bash.file, source: bash.source }, active: () => true },
    { command: 'printf x', description: 'authority drift' }, { agent: { session: { id: 's1', header: { cwd: scratch } } } }, policy, policy, {}, {})
  host.setMode('read-only')
  const value = await executing.result()
  assert.equal(value.status, 'failed')
  assert.match(value.error ?? '', /AUTHORITY_CHANGED/)
})

suite.test('a relative bashPath is refused before spawn', { skip: !hasBash }, () => {
  const host = hostFor()
  const policy = policyFor('danger-full-access')
  assert.throws(() => startSessionBash({ ctx: host.ctx, bash: { file: './bash', source: 'config' }, active: () => true },
    { command: 'printf x', description: 'relative' }, { agent: { session: { id: 's1', header: { cwd: scratch } } } }, policy, policy, {}, {}),
  /requires a resolved absolute executable path/)
})

suite.test('LC_ALL is neutralised instead of forced, so UTF-8 output stays readable', () => {
  const env = shellEnvOverrides({ LC_ALL: 'zh_CN.UTF-8' }, {})
  assert.equal(env.LC_ALL, '')
  assert.equal(env.LC_CTYPE, 'zh_CN.UTF-8')
  assert.equal(env.LC_MESSAGES, 'C')
  const explicit = shellEnvOverrides({ LC_ALL: 'zh_CN.UTF-8' }, { LC_CTYPE: 'C.UTF-8' })
  assert.equal(explicit.LC_CTYPE, 'C.UTF-8')
})

suite.test('the session workdir is anchored, never a host-relative path', () => {
  assert.equal(sessionWorkdir({ workdir: 'sub' }, { header: { cwd: scratch } }), path.resolve(scratch, 'sub'))
  assert.equal(sessionWorkdir({}, { header: { cwd: scratch } }), scratch)
  assert.equal(sessionWorkdir({ workdir: '   ' }, { header: { cwd: scratch } }), scratch)
})

suite.test('the default grace period matches the host executor', () => {
  assert.equal(DEFAULT_GRACE_MS, 3_000)
})

await suite.run()
fs.rmSync(scratch, { recursive: true, force: true })
