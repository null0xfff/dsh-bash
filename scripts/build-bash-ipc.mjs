#!/usr/bin/env node
/**
 * Build the Windows x64 MSYS IPC compatibility proxies this package's confined
 * mode requires, into `runtime/win32-x64/bash-ipc/`.
 *
 * Ported from `dsh-ops/bin/build-bash-ipc.mjs` (MIT, dsh-ops 0.4.1). It needs a
 * Visual Studio C++ toolchain (`vcvars64.bat`, discovered through vswhere or set
 * with `DSH_OPS_VCVARS64`) and the pinned, digest-verified bash payload that
 * `scripts/provision-bash.mjs` installs. No package or host binary is modified:
 * the proxies are built from `native/bash-ipc/*.cpp` and the MSYS DLL is patched
 * in memory by `lib/bash-pe.js`.
 *
 * Without this receipt, restricted modes (read-only / workspace-write) refuse to
 * run bash; danger-full-access still works with any resolved bash.
 */
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const { pinnedBashExecutable } = await import(new URL('../lib/shells/pinned.js', import.meta.url))
const { patchMsys, proxyDefinition } = await import(new URL('../lib/bash-pe.js', import.meta.url))

if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('Build the Bash IPC proxies on Windows x64')
const bash = pinnedBashExecutable({ file: process.env.DSH_OPS_TEST_BASH })
const source = path.resolve(path.dirname(bash), '../usr/bin/msys-2.0.dll')
const { exports } = patchMsys(fs.readFileSync(source))
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'bash-ipc-build-'))
const destination = path.join(root, 'runtime/win32-x64/bash-ipc')
const programFiles = process.env['ProgramFiles(x86)'] ?? 'C:/Program Files (x86)'
const vswhere = path.join(programFiles, 'Microsoft Visual Studio/Installer/vswhere.exe')
const discovered = fs.existsSync(vswhere)
  ? spawnSync(vswhere, ['-latest', '-products', '*', '-requires', 'Microsoft.VisualStudio.Component.VC.Tools.x86.x64', '-property', 'installationPath'], { encoding: 'utf8', windowsHide: true }).stdout.trim()
  : ''
const vcvars = process.env.DSH_OPS_VCVARS64 ?? (discovered ? path.join(discovered, 'VC/Auxiliary/Build/vcvars64.bat') : '')
if (!vcvars || !fs.existsSync(vcvars)) throw new Error('Set DSH_OPS_VCVARS64 to the installed vcvars64.bat')
try {
  const commands = ['@echo off', `call "${vcvars}" >nul`, 'if errorlevel 1 exit /b 1', `cd /d "${scratch}"`]
  for (const [dll, names] of Object.entries(exports)) {
    const name = dll === 'kernel32.dll' ? 'opsipc' : 'opsnt'
    fs.writeFileSync(path.join(scratch, `${name}.def`), proxyDefinition(names, dll))
    commands.push(`cl /nologo /LD /O2 /MT /std:c++20 /EHsc "${path.join(root, 'native/bash-ipc', `${name}.cpp`)}" /link /DEF:${name}.def /OUT:${name}.dll advapi32.lib normaliz.lib ntdll.lib`, 'if errorlevel 1 exit /b 1')
  }
  const file = path.join(scratch, 'build.cmd')
  fs.writeFileSync(file, `${commands.join('\r\n')}\r\n`)
  const build = spawnSync('cmd.exe', ['/d', '/c', file], { stdio: 'inherit', windowsHide: true })
  if (build.status !== 0) throw new Error(`IPC proxy build failed: ${build.status}`)
  fs.mkdirSync(destination, { recursive: true })
  const sha256 = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex')
  const files = {}
  for (const name of ['opsipc.dll', 'opsnt.dll']) {
    fs.copyFileSync(path.join(scratch, name), path.join(destination, name))
    files[name] = sha256(path.join(destination, name))
  }
  const sources = {}
  for (const name of ['security.h', 'opsipc.cpp', 'opsnt.cpp']) sources[name] = sha256(path.join(root, 'native/bash-ipc', name))
  fs.writeFileSync(path.join(destination, 'provenance.json'),
    `${JSON.stringify({ version: 1, platform: 'win32-x64', source: 'native/bash-ipc (original MIT)', sources, msysSha256: sha256(source), files }, null, 2)}\n`)
  console.log('Built and staged Windows Bash IPC compatibility proxies.')
} finally {
  fs.rmSync(scratch, { recursive: true, force: true })
}
