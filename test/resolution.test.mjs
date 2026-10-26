/** Resolution ladder: config -> provisioned -> bundled -> (opt-in) PATH / well-known. */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHome } from './lib/host.mjs'
import { createSuite } from './lib/harness.mjs'

const { resolveShells } = await import('../lib/shells.js')
const { resolveConfig } = await import('../lib/config.js')
const suite = createSuite('resolution')

const realHome = createHome()
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-bash-res-'))
const emptyProgramFiles = path.join(scratch, 'pf')
fs.mkdirSync(emptyProgramFiles, { recursive: true })

const resolve = (config = {}, options = {}) => resolveShells(resolveConfig(config), {
  bundleRoot: path.resolve(import.meta.dirname, '..'),
  env: realHome.env({ ProgramFiles: emptyProgramFiles, 'ProgramFiles(x86)': emptyProgramFiles, LOCALAPPDATA: scratch, USERPROFILE: scratch }),
  platform: 'win32',
  arch: 'x64',
  ...options,
})

const withHome = (fn) => {
  const home = createHome()
  try { fn(home) } finally { home.cleanup() }
}

suite.test('a configured executable is authoritative', () => withHome((home) => {
  const bash = home.store('bash', '9.9.9').executable
  const shells = resolveShells(resolveConfig({ bashPath: bash }), {
    bundleRoot: path.resolve(import.meta.dirname, '..'),
    env: home.env({ ProgramFiles: emptyProgramFiles }),
    platform: 'win32',
    arch: 'x64',
  })
  assert.equal(shells.bash.available, true)
  assert.equal(shells.bash.source, 'config')
  assert.equal(shells.bash.file, bash)
}))

suite.test('an unusable configured path reports unavailable instead of another shell', () => {
  const shells = resolve({ bashPath: path.join(scratch, 'nope', 'bash.exe') })
  assert.equal(shells.bash.available, false)
  assert.equal(shells.bash.source, 'config')
  assert.match(shells.bash.detail, /does not exist/)
})

suite.test('the provisioned store is preferred over PATH', () => withHome((home) => {
  const provisioned = home.store('bash', '1.0.0').executable
  const shells = resolveShells(resolveConfig({ allowSystemShellFallback: true }), {
    bundleRoot: path.resolve(import.meta.dirname, '..'),
    env: home.env({ ProgramFiles: emptyProgramFiles }),
    platform: 'win32',
    arch: 'x64',
  })
  assert.equal(shells.bash.source, 'provisioned')
  assert.equal(shells.bash.file, provisioned)
  assert.match(shells.bash.detail, /version 1\.0\.0/)
}))

suite.test('the greatest provisioned version wins', () => withHome((home) => {
  home.store('bash', '1.0.0')
  home.store('bash', '2.0.0')
  const shells = resolveShells(resolveConfig({}), {
    bundleRoot: path.resolve(import.meta.dirname, '..'),
    env: home.env({ ProgramFiles: emptyProgramFiles }),
    platform: 'win32',
    arch: 'x64',
  })
  assert.match(shells.bash.file, /2\.0\.0/)
}))

suite.test('without a managed copy and without opt-in the rung is disabled and names the remedy', () => {
  const home = createHome()
  const shells = resolveShells(resolveConfig({}), {
    bundleRoot: path.resolve(import.meta.dirname, '..'),
    env: home.env({ ProgramFiles: emptyProgramFiles }),
    platform: 'win32',
    arch: 'x64',
  })
  assert.equal(shells.bash.available, false)
  assert.equal(shells.bash.source, 'disabled')
  assert.match(shells.bash.detail, /allowSystemShellFallback is false/)
  assert.match(shells.bash.detail, /node bin\/dsh-bash\.mjs provision/)
  home.cleanup()
})

suite.test('with opt-in, PATH is searched and the WSL launcher is never accepted', () => {
  const home = createHome()
  const systemRoot = path.join(scratch, 'windows')
  fs.mkdirSync(path.join(systemRoot, 'System32'), { recursive: true })
  fs.writeFileSync(path.join(systemRoot, 'System32', 'bash.exe'), 'wsl launcher\n')
  const shells = resolveShells(resolveConfig({ allowSystemShellFallback: true }), {
    bundleRoot: path.resolve(import.meta.dirname, '..'),
    env: home.env({
      SystemRoot: systemRoot,
      PATH: path.join(systemRoot, 'System32'),
      ProgramFiles: emptyProgramFiles,
      'ProgramFiles(x86)': emptyProgramFiles,
      LOCALAPPDATA: scratch,
      USERPROFILE: scratch,
    }),
    platform: 'win32',
    arch: 'x64',
  })
  assert.equal(shells.bash.available, false)
  assert.equal(shells.bash.source, 'missing')
  assert.match(shells.bash.detail, /no bash found/)
  home.cleanup()
})

suite.test('with opt-in, a real PATH entry is used', () => {
  const home = createHome()
  const bin = path.join(scratch, 'bin2')
  fs.mkdirSync(bin, { recursive: true })
  const file = path.join(bin, 'bash.exe')
  fs.writeFileSync(file, 'shell\n')
  const shells = resolveShells(resolveConfig({ allowSystemShellFallback: true }), {
    bundleRoot: path.resolve(import.meta.dirname, '..'),
    env: home.env({ PATH: bin, ProgramFiles: emptyProgramFiles, 'ProgramFiles(x86)': emptyProgramFiles, LOCALAPPDATA: scratch, USERPROFILE: scratch }),
    platform: 'win32',
    arch: 'x64',
  })
  assert.equal(shells.bash.source, 'path')
  assert.equal(shells.bash.file, file)
  home.cleanup()
})

suite.test('a POSIX host answers with its own bash, no opt-in needed', () => {
  const home = createHome()
  const bin = path.join(scratch, 'posix-bin')
  fs.mkdirSync(bin, { recursive: true })
  const file = path.join(bin, 'bash')
  fs.writeFileSync(file, '#!/bin/sh\n')
  const shells = resolveShells(resolveConfig({}), {
    bundleRoot: path.resolve(import.meta.dirname, '..'),
    env: home.env({ PATH: bin }),
    platform: 'linux',
    arch: 'x64',
  })
  assert.equal(shells.bash.available, true)
  assert.equal(shells.bash.source, 'path')
  assert.match(shells.bash.detail, /distributions own bash|host distribution/)
  home.cleanup()
})

suite.test('a POSIX host with no bash names the distribution remedy', () => {
  const home = createHome()
  const shells = resolveShells(resolveConfig({}), {
    bundleRoot: path.resolve(import.meta.dirname, '..'),
    env: home.env({ PATH: path.join(scratch, 'empty') }),
    platform: 'darwin',
    arch: 'arm64',
  })
  assert.equal(shells.bash.available, false)
  assert.match(shells.bash.detail, /install bash with the distribution package manager/)
  home.cleanup()
})

suite.test('a bundled vendored payload outranks PATH', () => {
  const bundleRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-bash-bundle-'))
  fs.writeFileSync(path.join(bundleRoot, 'package.json'), JSON.stringify({ name: 'dsh-bash', version: '0.0.0' }))
  const vendored = path.join(bundleRoot, 'vendor', 'bash', 'win32-x64', 'bash.exe')
  fs.mkdirSync(path.dirname(vendored), { recursive: true })
  fs.writeFileSync(vendored, 'vendored shell\n')
  const home = createHome()
  const shells = resolveShells(resolveConfig({ allowSystemShellFallback: true }), {
    bundleRoot,
    env: home.env({ ProgramFiles: emptyProgramFiles }),
    platform: 'win32',
    arch: 'x64',
  })
  assert.equal(shells.bash.source, 'bundled')
  assert.equal(shells.bash.file, vendored)
  home.cleanup()
  fs.rmSync(bundleRoot, { recursive: true, force: true })
})

suite.test('publishBashTool:false disables the rung regardless of what exists', () => {
  const shells = resolve({ publishBashTool: false })
  assert.equal(shells.bash.available, false)
  assert.equal(shells.bash.source, 'disabled')
  assert.equal(shells.bash.detail, 'publishBashTool is false')
})

suite.test('the pwsh rung is host-owned and never published by this package', () => {
  const shells = resolve({})
  assert.equal(shells.pwsh.available, false)
  assert.equal(shells.pwsh.source, 'host')
  assert.match(shells.pwsh.detail, /managed by the host/)
})

suite.test('resolution never throws, whatever the environment looks like', () => {
  for (const scenario of [
    { env: {}, platform: 'win32' },
    { env: { PATH: '' }, platform: 'linux' },
    { env: { ProgramFiles: '\0bad' }, platform: 'win32' },
  ]) {
    assert.doesNotThrow(() => resolveShells(resolveConfig({}), { bundleRoot: scratch, ...scenario, arch: 'x64' }))
  }
})

realHome.cleanup()
fs.rmSync(scratch, { recursive: true, force: true })
await suite.run()
