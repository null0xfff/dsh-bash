/** The workdir rules: anchored at the session workspace, never at the host's own cwd. */
import assert from 'node:assert/strict'
import { createSuite } from './lib/harness.mjs'

const { sessionWorkdir } = await import('../lib/session-shells.js')
const suite = createSuite('workdir')

const win = (workdir, cwd = 'C:\\ws') => sessionWorkdir(workdir === undefined ? {} : { workdir }, { header: { cwd } })

suite.test('an omitted workdir is the session workspace', () => {
  assert.equal(win(undefined), 'C:\\ws')
  assert.equal(sessionWorkdir({}, { header: { cwd: '/home/u/ws' } }), '/home/u/ws')
})

suite.test('an empty or whitespace workdir is a placeholder, not a directory', () => {
  assert.equal(win(''), 'C:\\ws')
  assert.equal(win('   '), 'C:\\ws')
  assert.equal(win(null), 'C:\\ws')
})

suite.test('an absolute workdir passes through unchanged', () => {
  assert.equal(win('D:\\projects\\x'), 'D:\\projects\\x')
  assert.equal(sessionWorkdir({ workdir: '/home/u/x' }, { header: { cwd: '/home/u/ws' } }), '/home/u/x')
})

suite.test('a relative workdir is anchored at the session workspace', () => {
  assert.equal(win('sub'), 'C:\\ws\\sub')
  assert.equal(win('a/b'), 'C:\\ws\\a\\b')
  assert.equal(sessionWorkdir({ workdir: 'sub' }, { header: { cwd: '/home/u/ws' } }), '/home/u/ws/sub')
})

suite.test('a bash-style drive path is mapped onto the Windows form', () => {
  assert.equal(win('/d/projects'), 'D:\\projects')
  assert.equal(win('/c'), 'C:\\')
})

suite.test('a drive-less POSIX absolute path is refused on a Windows session', () => {
  for (const value of ['/tmp', '/', '/var/log']) {
    assert.throws(() => win(value), /carries no usable drive letter/)
  }
})

suite.test('a drive-relative path on the session drive is anchored, not trusted', () => {
  assert.equal(win('C:child'), 'C:\\ws\\child')
  assert.equal(win('c:'), 'C:\\ws')
})

suite.test('a drive-relative path on another drive is refused', () => {
  assert.throws(() => win('D:child'), /names drive D:/)
  assert.throws(() => sessionWorkdir({ workdir: 'D:child' }, { header: { cwd: '\\\\server\\share' } }), /no drive/)
})

suite.test('a rooted path without a drive stays on the session drive', () => {
  // `\child` is drive-rooted, so it resolves against the session DRIVE (C:\child),
  // never against the helper process's current directory.
  assert.equal(win('\\child'), 'C:\\child')
})

suite.test('a UNC path passes through', () => {
  assert.equal(win('\\\\server\\share\\x'), '\\\\server\\share\\x')
  assert.equal(win('//server/share/x'), '//server/share/x')
})

suite.test('a POSIX-spelled session keeps POSIX rules even on a Windows host', () => {
  assert.equal(sessionWorkdir({ workdir: '/tmp/x' }, { header: { cwd: '/home/u/ws' } }), '/tmp/x')
})

suite.test('a relative path without an absolute session workspace is refused', () => {
  assert.throws(() => sessionWorkdir({ workdir: 'sub' }, { header: { cwd: 'relative/ws' } }), /needs an absolute session workspace/)
  assert.throws(() => sessionWorkdir({ workdir: 'sub' }, {}), /needs an absolute session workspace/)
  assert.throws(() => sessionWorkdir({ workdir: 'sub' }, undefined), /needs an absolute session workspace/)
})

suite.test('a non-string workdir reaches the executor for its own rejection', () => {
  assert.equal(win(42), 42)
  const object = {}
  assert.equal(win(object), object)
})

await suite.run()
