/** The package as the host sees it: manifest, bundle patch, exports, prompt section. */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { parse as parseYaml } from 'yaml'
import { createSuite } from './lib/harness.mjs'

const pkgRoot = path.resolve(import.meta.dirname, '..')
const readJson = relative => JSON.parse(fs.readFileSync(path.join(pkgRoot, relative), 'utf8'))
const suite = createSuite('packaging')

const pkg = readJson('package.json')
const manifest = readJson('dsh-plugin.json')
const { resolveConfig } = await import('../lib/config.js')
const { TOOLING_SECTION, BASH_TOOL, TOOL_PREFIX } = await import('../lib/policy.js')

suite.test('package.json describes an ESM package with a built entry', () => {
  assert.equal(pkg.type, 'module')
  assert.equal(pkg.license, 'MIT')
  assert.equal(pkg.main, 'lib/index.js')
  assert.ok(fs.existsSync(path.join(pkgRoot, pkg.main)))
})

suite.test('every declared export points at a file that exists', () => {
  for (const [key, value] of Object.entries(pkg.exports)) {
    const target = typeof value === 'string' ? value : value.default ?? value.types
    if (target.includes('*')) continue
    assert.ok(fs.existsSync(path.join(pkgRoot, target)), `${key} -> ${target} is missing`)
  }
})

suite.test('the files whitelist publishes every runtime payload', () => {
  for (const entry of ['lib', 'bin', 'scripts', 'native', 'licenses', 'docs', 'locale', 'cordis.patch.yml', 'dsh-plugin.json', 'README.md', 'LICENSE', 'NOTICE']) {
    assert.ok(pkg.files.includes(entry), `${entry} is not published`)
  }
})

suite.test('the manifest version, name and licence match package.json', () => {
  assert.equal(manifest.manifestVersion, '0.15')
  assert.equal(manifest.version, pkg.version)
  assert.equal(manifest.name, pkg.name)
  assert.equal(manifest.license, pkg.license)
})

suite.test('the manifest host facet declares an existing entry and api version', () => {
  assert.equal(manifest.facets.host.apiVersion, 'v1alpha1')
  assert.ok(fs.existsSync(path.join(pkgRoot, manifest.facets.host.entry)))
})

suite.test('the manifest requires the Tool contract', () => {
  const contract = manifest.requires.contracts.find(item => item.kind === 'Tool')
  assert.equal(contract.apiVersion, 'tools.dsh/v1alpha1')
})

suite.test('the manifest tool namespace matches the policy module', () => {
  const namespace = manifest.contributes['x-tool-namespaces'][0]
  assert.equal(namespace.serverName, 'dsh-bash')
  assert.equal(namespace.transport, 'in-process')
  assert.equal(namespace.publicPrefix, TOOL_PREFIX)
  assert.deepEqual(namespace.tools, ['bash'])
  assert.equal(`${namespace.publicPrefix}${namespace.tools[0]}`, BASH_TOOL)
})

suite.test('the single component row maps to the shell export', () => {
  const rows = manifest.contributes['x-components']
  assert.equal(rows.length, 1)
  const row = rows[0]
  assert.equal(row.id, 'dsh-bash-shell')
  assert.equal(row.entry, 'dsh-bash/shell')
  assert.equal(row.defaultEnabled, true)
  assert.deepEqual(row.tools, ['ops_bash'])
  assert.ok(pkg.exports['./shell'])
  assert.ok(fs.existsSync(path.join(pkgRoot, pkg.exports['./shell'].default)))
})

suite.test('the declared prompt section is the one the policy registers', () => {
  const sections = manifest.contributes['x-prompt-sections']
  assert.equal(sections.length, 1)
  assert.equal(sections[0].name, TOOLING_SECTION)
  assert.equal(typeof sections[0].order, 'number')
})

suite.test('the display metadata points at real, package-relative files', () => {
  const display = manifest.contributes['x-display'][0]
  assert.equal(display.icon, './docs/assets/icon.png')
  assert.ok(fs.existsSync(path.join(pkgRoot, display.icon)))
  for (const locale of display.locales) {
    const file = path.join(pkgRoot, locale)
    assert.ok(fs.existsSync(file), `${locale} is missing`)
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'))
    assert.ok(parsed.meta.title && parsed.meta.description, `${locale} has no display text`)
  }
})

suite.test('the component row metadata parses and names the package', () => {
  for (const relative of ['lib/components/shell/package.json', 'lib/components/shell/locale/en.json', 'lib/components/shell/locale/zh.json']) {
    assert.doesNotThrow(() => JSON.parse(fs.readFileSync(path.join(pkgRoot, relative), 'utf8')), `${relative} is not JSON`)
  }
  assert.equal(readJson('lib/components/shell/package.json').name, 'dsh-bash')
})

suite.test('the bundle patch is one row whose config this package accepts', () => {
  const document = parseYaml(fs.readFileSync(path.join(pkgRoot, 'cordis.patch.yml'), 'utf8'))
  assert.ok(Array.isArray(document))
  const rows = document.flatMap(entry => entry.insert ?? [])
  assert.equal(rows.length, 1)
  const row = rows[0]
  assert.equal(row.id, 'dsh-bash-shell')
  assert.equal(row.name, 'dsh-bash/shell')
  assert.doesNotThrow(() => resolveConfig(row.config))
})

suite.test('the patch defaults equal the code defaults', () => {
  const document = parseYaml(fs.readFileSync(path.join(pkgRoot, 'cordis.patch.yml'), 'utf8'))
  const config = resolveConfig(document.flatMap(entry => entry.insert ?? [])[0].config)
  const defaults = resolveConfig({})
  assert.equal(config.promptPolicy, defaults.promptPolicy)
  assert.equal(config.publishBashTool, defaults.publishBashTool)
  assert.equal(config.shellPolicy, defaults.shellPolicy)
  assert.equal(config.allowSystemShellFallback, defaults.allowSystemShellFallback)
})

suite.test('the package exports its locale documents for the plugin card', () => {
  assert.equal(pkg.exports['./locale/*.json'], './locale/*.json')
  assert.equal(pkg.icon, './docs/assets/icon.png')
})

suite.test('the Windows preparation script ships with the package', () => {
  assert.ok(fs.existsSync(path.join(pkgRoot, 'bin/prepare-workspace.ps1')))
  const preparation = fs.readFileSync(path.join(pkgRoot, 'lib/workspace-preparation.js'), 'utf8')
  assert.match(preparation, /\.\.\/bin\/prepare-workspace\.ps1/)
})

suite.test('the native IPC sources ship for a local confined-mode build', () => {
  for (const name of ['opsipc.cpp', 'opsnt.cpp', 'security.h', 'README.md']) {
    assert.ok(fs.existsSync(path.join(pkgRoot, 'native/bash-ipc', name)), `${name} is missing`)
  }
})

suite.test('no compiled module imports a host package as a value', () => {
  const offenders = []
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (entry.name.endsWith('.js') && /(?:^|\n)\s*import\s[^;\n]*from\s*'@deepseek-ai\//.test(fs.readFileSync(full, 'utf8'))) {
        offenders.push(path.relative(pkgRoot, full))
      }
    }
  }
  walk(path.join(pkgRoot, 'lib'))
  assert.deepEqual(offenders, [])
})

suite.test('the provisioner script verifies both digests before installing', () => {
  const script = fs.readFileSync(path.join(pkgRoot, 'scripts/provision-bash.mjs'), 'utf8')
  assert.match(script, /pin\.sha256/)
  assert.match(script, /pin\.executableSha256/)
  assert.match(script, /refusing to install bytes this distribution did not pin/)
  assert.match(script, /schemaVersion: 1/)
})

suite.test('the package declares the host versions it was built against', () => {
  assert.equal(pkg.devDependencies['@deepseek-ai/dsh-tools'], '0.2.1-rc.3')
  assert.match(pkg.engines.dsh, /0\.2\.1-rc\.3/)
  assert.ok(pkg.peerDependenciesMeta['@deepseek-ai/dsh'].optional)
})

await suite.run()
