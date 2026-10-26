#!/usr/bin/env node
/**
 * Operator CLI for the extracted bash component.
 *
 *   node bin/dsh-bash.mjs status        # what bash would run, and why
 *   node bin/dsh-bash.mjs provision     # install the pinned upstream bash
 *   node bin/dsh-bash.mjs build-ipc     # build the Windows confined-mode proxies
 *
 * Ported from the relevant parts of `dsh-ops/bin/dsh-ops.mjs` + `src/cli/*`
 * (MIT, dsh-ops 0.4.1), reduced to the bash rung.
 */
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const { resolveShells } = await import(new URL('../lib/shells.js', import.meta.url))
const { resolveConfig } = await import(new URL('../lib/config.js', import.meta.url))
const { managedBashInventory } = await import(new URL('../lib/shells/manager.js', import.meta.url))
const { restrictedCompatibility } = await import(new URL('../lib/bash-ipc.js', import.meta.url))

const command = process.argv[2] ?? 'status'
const passthrough = process.argv.slice(3)

function status() {
  const config = resolveConfig({})
  const shells = resolveShells(config)
  const bash = shells.bash
  console.log(`platform: ${process.platform}-${process.arch}`)
  console.log(`tool:     ops_bash`)
  console.log(`bash:     ${bash.available ? 'available' : 'unavailable'}`)
  console.log(`  source: ${bash.source}`)
  if (bash.file) console.log(`  file:   ${bash.file}`)
  console.log(`  detail: ${bash.detail}`)
  const inventory = managedBashInventory()
  console.log(`store:    ${inventory.length} version(s) under DSH_HOME`)
  for (const entry of inventory) console.log(`  ${entry.version}${entry.owned ? ' (owned)' : ' (foreign)'} — ${entry.directory}`)
  if (process.platform === 'win32' && bash.file) {
    const compatibility = restrictedCompatibility(bash.file)
    console.log(`restricted modes: ${compatibility.compatible ? 'compatible' : 'unavailable'}`)
    console.log(`  ${compatibility.reason}`)
  }
  if (!bash.available) process.exitCode = 1
}

function delegate(script) {
  const result = spawnSync(process.execPath, [path.join(root, 'scripts', script), ...passthrough], { stdio: 'inherit' })
  if (result.error) throw result.error
  process.exitCode = result.status ?? 1
}

switch (command) {
  case 'status': status(); break
  case 'provision': delegate('provision-bash.mjs'); break
  case 'build-ipc': delegate('build-bash-ipc.mjs'); break
  default:
    console.error(`dsh-bash: unknown command ${JSON.stringify(command)}; expected status, provision or build-ipc`)
    process.exitCode = 2
}
