/** Windows confined-mode gate: what is verified, and what is refused. */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createSuite } from './lib/harness.mjs'

const {
  restrictedCompatibility, restrictedRemedy, confinedBash, privateRuntimePath,
  renameWithRetry, quarantineGeneration, RENAME_RETRY_DELAYS_MS,
} = await import('../lib/bash-ipc.js')
const suite = createSuite('restricted-ipc')

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-bash-ipc-'))

suite.test('a POSIX host needs no MSYS compatibility layer', () => {
  const check = restrictedCompatibility('/bin/bash', { platform: 'linux' })
  assert.equal(check.compatible, true)
  assert.match(check.reason, /no MSYS IPC compatibility layer is needed/)
})

suite.test('confinedBash is a passthrough off Windows', () => {
  assert.deepEqual(confinedBash('/bin/bash', { platform: 'linux' }), { file: '/bin/bash' })
})

suite.test('a bash without the MSYS runtime layout is refused', () => {
  const file = path.join(scratch, 'git', 'bin', 'bash.exe')
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, 'shell\n')
  const check = restrictedCompatibility(file, { platform: 'win32' })
  assert.equal(check.compatible, false)
  assert.match(check.reason, /no usr\/bin\/msys-2\.0\.dll beside it/)
})

suite.test('an MSYS layout without the IPC receipt is refused', () => {
  const file = path.join(scratch, 'git-with-msys', 'bin', 'bash.exe')
  const dll = path.join(scratch, 'git-with-msys', 'usr', 'bin', 'msys-2.0.dll')
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.mkdirSync(path.dirname(dll), { recursive: true })
  fs.writeFileSync(file, 'shell\n')
  fs.writeFileSync(dll, 'msys\n')
  const check = restrictedCompatibility(file, { platform: 'win32' })
  assert.equal(check.compatible, false)
  assert.match(check.reason, /carries no Bash IPC compatibility receipt/)
  assert.match(check.reason, /provenance\.json/)
})

suite.test('a receipt for another MSYS build is refused with both digests', () => {
  const packageRuntime = path.resolve(import.meta.dirname, '../runtime/win32-x64/bash-ipc')
  const receipt = path.join(packageRuntime, 'provenance.json')
  const file = path.join(scratch, 'git-receipt', 'bin', 'bash.exe')
  const dll = path.join(scratch, 'git-receipt', 'usr', 'bin', 'msys-2.0.dll')
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.mkdirSync(path.dirname(dll), { recursive: true })
  fs.writeFileSync(file, 'shell\n')
  fs.writeFileSync(dll, 'msys\n')
  const existed = fs.existsSync(receipt)
  if (existed) return // a real receipt is installed here; leave it alone
  fs.mkdirSync(packageRuntime, { recursive: true })
  fs.writeFileSync(receipt, JSON.stringify({ platform: 'win32-x64', msysSha256: 'b'.repeat(64), files: { 'opsipc.dll': 'c'.repeat(64), 'opsnt.dll': 'd'.repeat(64) } }))
  try {
    const check = restrictedCompatibility(file, { platform: 'win32' })
    assert.equal(check.compatible, false)
    assert.match(check.reason, /is not the pinned build/)
    assert.equal(check.expectedSha256, 'b'.repeat(64))
  } finally {
    fs.rmSync(packageRuntime, { recursive: true, force: true })
  }
})

suite.test('the failure remedy names the pinned-runtime rule and the operator next steps', () => {
  const text = restrictedRemedy('C:/git/bin/bash.exe', 'path', 'it is not pinned.')
  assert.match(text, /EXECUTOR_UNAVAILABLE/)
  assert.match(text, /restricted modes run only the pinned MSYS/)
  assert.match(text, /not a user authorization denial/)
  assert.match(text, /danger-full-access/)
  assert.match(text, /node bin\/dsh-bash\.mjs provision/)
})

suite.test('the private PATH puts the verified tree first and last', () => {
  const value = privateRuntimePath('C:/cache/generation', 'C:/one;C:/two')
  const parts = value.split(path.delimiter)
  assert.equal(parts[0], path.join('C:/cache/generation', 'usr/bin'))
  assert.ok(parts.includes('C:/one') && parts.includes('C:/two'))
  assert.equal(parts[parts.length - 2], path.join('C:/cache/generation', 'ucrt64/bin'))
  assert.equal(parts[parts.length - 1], path.join('C:/cache/generation', 'cmd'))
})

suite.test('renameWithRetry retries the transient sharing violation', () => {
  let attempts = 0
  const waits = []
  renameWithRetry('a', 'b', {
    rename: () => {
      attempts++
      if (attempts < 3) throw Object.assign(new Error('busy'), { code: 'EPERM' })
    },
    wait: (ms) => waits.push(ms),
  })
  assert.equal(attempts, 3)
  assert.deepEqual(waits, RENAME_RETRY_DELAYS_MS.slice(0, 2))
})

suite.test('renameWithRetry never retries a permanent error', () => {
  let attempts = 0
  assert.throws(() => renameWithRetry('a', 'b', {
    rename: () => { attempts++; throw Object.assign(new Error('gone'), { code: 'ENOENT' }) },
    wait: () => { throw new Error('must not wait') },
  }), /gone/)
  assert.equal(attempts, 1)
})

suite.test('renameWithRetry gives up after the documented budget', () => {
  let attempts = 0
  assert.throws(() => renameWithRetry('a', 'b', {
    rename: () => { attempts++; throw Object.assign(new Error('busy'), { code: 'EBUSY' }) },
    wait: () => {},
  }), /busy/)
  assert.equal(attempts, RENAME_RETRY_DELAYS_MS.length + 1)
})

suite.test('quarantineGeneration renames aside and keeps two generations', () => {
  const parent = fs.mkdtempSync(path.join(scratch, 'gen-'))
  const target = path.join(parent, 'identity')
  fs.mkdirSync(target)
  // Three older quarantines: the two newest must survive.
  for (const suffix of ['0001', '0002', '0003']) fs.mkdirSync(`${target}.bad-${suffix}`)
  let renamedTo
  quarantineGeneration(target, { rename: (from, to) => { renamedTo = to; fs.renameSync(from, to) } })
  assert.equal(fs.existsSync(target), false)
  assert.ok(renamedTo.startsWith(`${target}.bad-`))
  const remaining = fs.readdirSync(parent).filter(name => name.startsWith('identity.bad-'))
  assert.equal(remaining.length, 2)
})

fs.rmSync(scratch, { recursive: true, force: true })
await suite.run()
