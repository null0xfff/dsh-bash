#!/usr/bin/env node
/**
 * Check that this package is installed into a DSH profile and can resolve a bash.
 *
 *   node scripts/verify-install.mjs [profile]
 *
 * It reads the profile manifest, proves the installed copy is the built package,
 * imports the row entry from that profile's own node_modules, and prints what
 * `ops_bash` would run. It never boots the app and never writes to the profile.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const profileName = process.argv[2] ?? 'desktop'
const home = process.env.DSH_HOME ?? path.join(os.homedir(), '.dsh')
const profile = path.join(home, 'profiles', profileName)
const installed = path.join(profile, 'node_modules', 'dsh-bash')

const problems = []
const info = []

if (!fs.existsSync(profile)) problems.push(`profile ${profileName} does not exist (${profile})`)
if (!fs.existsSync(path.join(installed, 'package.json'))) problems.push(`dsh-bash is not installed in ${profileName}`)
if (fs.existsSync(path.join(installed, 'package.json'))) {
  const manifest = JSON.parse(fs.readFileSync(path.join(profile, 'package.json'), 'utf8'))
  const bundles = manifest.dsh?.profile?.bundles ?? []
  const dependency = manifest.dependencies?.['dsh-bash']
  info.push(`package:     ${JSON.parse(fs.readFileSync(path.join(installed, 'package.json'), 'utf8')).version}`)
  info.push(`dependency:  ${dependency ?? '(not declared)'}`)
  info.push(`bundle row:  ${bundles.includes('dsh-bash') ? 'listed' : 'MISSING from dsh.profile.bundles'}`)
  if (!bundles.includes('dsh-bash')) problems.push('the profile does not list dsh-bash in dsh.profile.bundles')
  for (const relative of ['lib/index.js', 'lib/components/shell/index.js', 'cordis.patch.yml', 'dsh-plugin.json']) {
    if (!fs.existsSync(path.join(installed, relative))) problems.push(`installed copy is missing ${relative}`)
  }
  // Import through the profile, exactly as the Loader resolves it.
  process.chdir(profile)
  const row = await import('dsh-bash/shell')
  const host = await import('dsh-bash')
  if (typeof row.apply !== 'function') problems.push('dsh-bash/shell does not export apply()')
  if ('Config' in row) problems.push('dsh-bash/shell exports Config; the Loader validates it as a schema and activation fails')
  const shells = host.resolveShells(host.resolveConfig({}))
  info.push(`bash:        ${shells.bash.available ? shells.bash.file : 'unavailable'}`)
  info.push(`source:      ${shells.bash.source}`)
  if (!shells.bash.available) problems.push(`no bash resolvable: ${shells.bash.detail}`)
  if (process.platform === 'win32' && shells.bash.available) {
    const { restrictedCompatibility } = await import(pathToFileURL(path.join(installed, 'lib/bash-ipc.js')).href)
    const check = restrictedCompatibility(shells.bash.file)
    info.push(`restricted:  ${check.compatible ? 'compatible' : `unavailable (${check.reason})`}`)
  }
}

for (const line of info) console.log(line)
if (problems.length === 0) {
  console.log(`\nverify-install: ${profileName} is ready; restart the app (or reload the profile) to publish ops_bash.`)
} else {
  console.error(`\nverify-install: ${problems.length} problem(s)`)
  for (const problem of problems) console.error(`  - ${problem}`)
  process.exitCode = 1
}
