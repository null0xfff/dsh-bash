/** The managed bash store: receipts, ownership, selection and removal. */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createHome } from './lib/host.mjs'
import { createSuite } from './lib/harness.mjs'

const { managedBashInventory, removeManagedBash, selectBashRuntime, gitBashCandidates } = await import('../lib/shells/manager.js')
const { provisionedShell, provisionedShellVersionDir, shellUpstreamPin } = await import('../lib/shells.js')
const { resolveShells } = await import('../lib/shells.js')
const { resolveConfig } = await import('../lib/config.js')
const suite = createSuite('provisioner')

// The pinned bash payload is a win32 one, so these cases name the platform they resolve for
// instead of inheriting the runner's: a POSIX host then answers the same question.
const WINDOWS_BASH = { platform: 'win32', arch: 'x64' }
const WINDOWS_BASH_PIN = shellUpstreamPin({ kind: 'bash', ...WINDOWS_BASH })

suite.test('the store path is under DSH_HOME and names this package', () => {
  const home = createHome()
  const directory = provisionedShellVersionDir({ kind: 'bash', version: '1.2.3', env: home.env() })
  assert.ok(directory.startsWith(path.join(home.home, 'dsh-bash', 'shells', 'bash')))
  assert.ok(directory.endsWith(path.join('1.2.3')))
  home.cleanup()
})

suite.test('a receipt from this provisioner is recognised as owned', () => {
  const home = createHome()
  const { directory } = home.store('bash', '2.56.0.2')
  home.receipt(directory, '2.56.0.2')
  const inventory = managedBashInventory({ env: home.env() })
  assert.equal(inventory.length, 1)
  assert.equal(inventory[0].owned, true)
  assert.equal(inventory[0].version, '2.56.0.2')
  home.cleanup()
})

suite.test('a version directory without a receipt is foreign and never removed', () => {
  const home = createHome()
  home.store('bash', 'handmade')
  const inventory = managedBashInventory({ env: home.env() })
  assert.deepEqual(inventory.map(entry => [entry.version, entry.owned]), [['handmade', false]])
  const result = removeManagedBash({ env: home.env(), yes: true })
  assert.equal(result.action, 'removed')
  assert.deepEqual(result.kept.map(entry => entry.version), ['handmade'])
  assert.equal(fs.existsSync(path.join(home.home, 'dsh-bash', 'shells', 'bash', 'handmade')), true)
  home.cleanup()
})

suite.test('a malformed receipt makes the copy foreign, not owned', () => {
  const home = createHome()
  const { directory } = home.store('bash', '1.0.0')
  fs.writeFileSync(path.join(directory, '.provisioned.json'), '{not json')
  assert.equal(managedBashInventory({ env: home.env() })[0].owned, false)
  home.cleanup()
})

suite.test('a receipt with the wrong schema version is foreign', () => {
  const home = createHome()
  const { directory } = home.store('bash', '1.0.0')
  fs.writeFileSync(path.join(directory, '.provisioned.json'), JSON.stringify({ schemaVersion: 2, name: 'bash', version: '1.0.0', sha256: 'a'.repeat(64) }))
  assert.equal(managedBashInventory({ env: home.env() })[0].owned, false)
  home.cleanup()
})

suite.test('removal previews without touching the disk', () => {
  const home = createHome()
  const { directory } = home.store('bash', '1.0.0')
  home.receipt(directory, '1.0.0')
  const preview = removeManagedBash({ env: home.env(), yes: false })
  assert.equal(preview.action, 'preview')
  assert.deepEqual(preview.versions.map(entry => entry.version), ['1.0.0'])
  assert.equal(fs.existsSync(directory), true)
  home.cleanup()
})

suite.test('confirmed removal deletes only owned copies', () => {
  const home = createHome()
  const owned = home.store('bash', '1.0.0').directory
  home.receipt(owned, '1.0.0')
  home.store('bash', 'foreign')
  const result = removeManagedBash({ env: home.env(), yes: true })
  assert.deepEqual(result.versions.map(entry => entry.version), ['1.0.0'])
  assert.equal(fs.existsSync(owned), false)
  assert.deepEqual(result.kept.map(entry => entry.version), ['foreign'])
  home.cleanup()
})

suite.test('the resolved store copy is what the ladder reports', () => {
  const home = createHome()
  home.store('bash', '7.7.7')
  const shells = resolveShells(resolveConfig({}), { bundleRoot: home.home, env: home.env(), platform: 'win32', arch: 'x64' })
  assert.equal(shells.bash.source, 'provisioned')
  assert.match(shells.bash.file, /7\.7\.7/)
  assert.equal(provisionedShell({ kind: 'bash', env: home.env(), platform: 'win32', arch: 'x64' }).version, '7.7.7')
  home.cleanup()
})

suite.test('selectBashRuntime("managed") picks the greatest owned version', () => {
  const home = createHome()
  // The store is laid out on the pin's own relative path, so the case exercises the selection
  // (greatest version, receipt-marked only) rather than the payload name of this host.
  for (const version of ['1.0.0', '2.0.0'])
    home.receipt(home.store('bash', version, WINDOWS_BASH_PIN.executableRelativePath).directory, version)
  const selection = selectBashRuntime('managed', { env: home.env(), ...WINDOWS_BASH })
  assert.equal(selection.source, 'managed')
  assert.ok(selection.file.endsWith(path.join('2.0.0', WINDOWS_BASH_PIN.executableRelativePath)))
  assert.deepEqual(selection.config, { bashPath: selection.file })
  home.cleanup()
})

suite.test('outside Windows there is no managed bash pin to select', () => {
  const home = createHome()
  // A store laid out for the Windows pin is still not a POSIX selection: no POSIX pin exists, so
  // the rung cannot name a payload and refuses instead of guessing one.
  for (const version of ['1.0.0', '2.0.0'])
    home.receipt(home.store('bash', version, WINDOWS_BASH_PIN.executableRelativePath).directory, version)
  assert.throws(() => selectBashRuntime('managed', { env: home.env(), platform: 'linux', arch: 'x64' }), /No managed Bash is installed/)
  home.cleanup()
})

suite.test('selectBashRuntime("managed") refuses when nothing is installed', () => {
  const home = createHome()
  assert.throws(() => selectBashRuntime('managed', { env: home.env() }), /No managed Bash is installed/)
  home.cleanup()
})

suite.test('selectBashRuntime("git") refuses when no Git install exists', () => {
  const home = createHome()
  const empty = path.join(home.home, 'empty')
  fs.mkdirSync(empty, { recursive: true })
  const env = home.env({ ProgramFiles: empty, 'ProgramFiles(x86)': empty, LOCALAPPDATA: empty, USERPROFILE: empty })
  assert.deepEqual(gitBashCandidates({ env, platform: 'win32' }), [])
  assert.throws(() => selectBashRuntime('git', { env }), /No Git Bash installation found/)
  home.cleanup()
})

suite.test('git candidates only ever name real Git layouts', () => {
  assert.deepEqual(gitBashCandidates({ env: process.env, platform: 'linux' }), [])
})

await suite.run()
