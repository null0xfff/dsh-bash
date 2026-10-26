#!/usr/bin/env node
/**
 * Conformance gate for this DSH plugin package.
 *
 * Parses `dsh-plugin.json` with the pinned Community v0.15 parser from
 * `@dsh-std/manifest` — not with a hand-written check — then asserts the facts this
 * repository can get wrong about itself: manifest/package version agreement, the
 * declared host entry and bundle patch existing, the tool namespace and prompt
 * section matching the code, the display icon/locales resolving through the package
 * exports, and the published `files` whitelist carrying every runtime payload.
 *
 *   node scripts/validate-manifest.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse as parseYaml } from 'yaml'
import { parseManifest, projectManifest } from '@dsh-std/manifest'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const readJson = relative => JSON.parse(fs.readFileSync(path.join(root, relative), 'utf8'))
const exists = relative => fs.existsSync(path.join(root, relative))

const failures = []
const notes = []
const check = (condition, description, detail) => {
  if (condition) { notes.push(`  ok   ${description}`); return }
  failures.push(detail === undefined ? description : `${description} — ${detail}`)
  notes.push(`  FAIL ${description}`)
}

const manifestText = fs.readFileSync(path.join(root, 'dsh-plugin.json'), 'utf8')
const manifestRaw = JSON.parse(manifestText)
const pkg = readJson('package.json')

let manifest
let projection
try {
  manifest = parseManifest(manifestText, { source: 'dsh-plugin.json' })
  projection = projectManifest(manifest)
  check(true, 'dsh-plugin.json parses under the Community v0.15 parser')
} catch (error) {
  check(false, 'dsh-plugin.json parses under the Community v0.15 parser', String(error?.message ?? error))
}

if (manifest !== undefined) {
  check(manifest.manifestVersion === '0.15', 'manifestVersion is 0.15', `got ${JSON.stringify(manifest.manifestVersion)}`)
  check(typeof manifest.$schema === 'string' && /^https?:/i.test(manifest.$schema), '$schema is an absolute URI')
  check(manifest.version === pkg.version, 'manifest version matches package.json', `manifest ${manifest.version} vs package ${pkg.version}`)
  check(manifest.name === pkg.name, 'manifest name matches package.json', `manifest ${manifest.name} vs package ${pkg.name}`)
  check(manifest.license === pkg.license, 'manifest license matches package.json')
  const entry = manifest.facets.host.entry
  check(exists(entry), `declared host entry exists (${entry})`)
  check(manifest.facets.host.apiVersion === 'v1alpha1', 'host facet declares v1alpha1')
  const toolContract = manifest.requires.contracts.find(contract => contract.kind === 'Tool')
  check(toolContract?.apiVersion === 'tools.dsh/v1alpha1', 'requires.contracts declares the Tool coordinate')
}

if (projection !== undefined) {
  check(projection.spec.facets.some(facet => facet.name === 'host'), 'the projection contains the host facet')
  check(projection.metadata.version === pkg.version, 'the projection carries the package version')
}

check(typeof pkg.dsh?.bundle?.patch === 'string' && exists(pkg.dsh.bundle.patch), `dsh.bundle.patch exists (${String(pkg.dsh?.bundle?.patch)})`)

if (typeof pkg.dsh?.bundle?.patch === 'string' && exists(pkg.dsh.bundle.patch)) {
  let document
  try {
    document = parseYaml(fs.readFileSync(path.join(root, pkg.dsh.bundle.patch), 'utf8'))
    check(true, 'the bundle patch is valid YAML')
  } catch (error) {
    check(false, 'the bundle patch is valid YAML', String(error?.message ?? error))
  }
  if (document !== undefined) {
    const rows = Array.isArray(document) ? document.flatMap(item => item?.insert ?? []) : []
    check(rows.length === 1, 'the bundle declares exactly one component row', `got ${rows.length}`)
    const row = rows[0]
    check(row?.id === 'dsh-bash-shell', 'the row uses the stable id dsh-bash-shell')
    check(row?.name === 'dsh-bash/shell', 'the row resolves the package shell entry')
    const { resolveConfig } = await import(pathToFileUrl('lib/config.js'))
    try {
      resolveConfig(row?.config)
      check(true, 'the row config passes the package validator')
    } catch (error) {
      check(false, 'the row config passes the package validator', String(error?.message ?? error))
    }
  }
}

function pathToFileUrl(relative) {
  return new URL(`file://${path.join(root, relative).replaceAll('\\', '/')}`).href
}

const namespaces = manifestRaw.contributes?.['x-tool-namespaces'] ?? []
const hosted = namespaces[0]
const { BASH_TOOL, TOOL_PREFIX, TOOLING_SECTION } = await import(pathToFileUrl('lib/policy.js'))
check(hosted?.serverName === 'dsh-bash', 'the tool namespace is owned by dsh-bash')
check(hosted?.transport === 'in-process', 'the tool namespace is in-process')
check(hosted?.publicPrefix === TOOL_PREFIX, `the namespace publishes under ${TOOL_PREFIX}`)
check(JSON.stringify(hosted?.tools) === JSON.stringify(['bash']), 'the namespace declares exactly the bash tool')
check(`${hosted?.publicPrefix}${hosted?.tools?.[0]}` === BASH_TOOL, 'the declared tool name matches the policy module')

const sections = manifestRaw.contributes?.['x-prompt-sections'] ?? []
check(sections.length === 1 && sections[0].name === TOOLING_SECTION, 'the declared prompt section matches the policy module')
check(typeof sections[0]?.order === 'number', 'the prompt section carries a numeric order')

const components = manifestRaw.contributes?.['x-components'] ?? []
check(components.length === 1, 'exactly one component is declared')
const component = components[0]
check(component?.entry === 'dsh-bash/shell', 'the component entry is the package shell export')
check(JSON.stringify(component?.tools) === JSON.stringify([BASH_TOOL]), 'the component declares ops_bash')
check(component?.defaultEnabled === true, 'the component is enabled by default')
check(typeof pkg.exports?.['./shell']?.default === 'string' && exists(pkg.exports['./shell'].default), 'the ./shell export points at a built file')

const display = manifestRaw.contributes?.['x-display']?.[0]
const icon = display?.icon?.replace(/^\.\//u, '')
check(display !== undefined && icon !== undefined && exists(icon), 'the display icon exists', icon)
check(display?.icon === pkg.icon, 'the display icon matches package.json icon')
for (const locale of display?.locales ?? []) {
  const relative = locale.replace(/^\.\//u, '')
  if (!exists(relative)) { check(false, `the locale ${relative} exists`); continue }
  const parsed = readJson(relative)
  check(typeof parsed?.meta?.title === 'string' && typeof parsed?.meta?.description === 'string', `the locale ${relative} carries display text`)
}
check((display?.locales ?? []).length >= 2, 'the display declares at least English and Chinese locales')
check(pkg.exports?.['./locale/*.json'] !== undefined, 'the package exports its locale documents')

const required = ['lib', 'bin', 'scripts', 'native', 'licenses', 'cordis.patch.yml', 'dsh-plugin.json', 'README.md', 'LICENSE', 'docs', 'locale']
const missing = required.filter(entry => !(pkg.files ?? []).includes(entry))
check(missing.length === 0, 'the files whitelist publishes every payload', `missing: ${missing.join(', ') || '(none)'}`)
check(!(pkg.files ?? []).some(entry => /(?:^|\/)(?:node_modules|test)(?:\/|$)/.test(entry)), 'the files whitelist excludes tests and dependencies')
check(exists(pkg.main), `the package main exists (${String(pkg.main)})`)

for (const line of notes) console.log(line)
if (failures.length > 0) {
  console.error(`\nvalidate-manifest: ${failures.length} check(s) failed`)
  for (const failure of failures) console.error(`  - ${failure}`)
  process.exitCode = 1
} else {
  console.log(`\nvalidate-manifest: all ${notes.length} checks passed`)
}
