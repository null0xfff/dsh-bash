/** The routing policy text and the host-shell refusal — what the model is told. */
import assert from 'node:assert/strict'
import { createSuite } from './lib/harness.mjs'

const { TOOLING_SECTION, SECTION_ORDERS, TOOL_PREFIX, publicToolName, BASH_TOOL, renderToolingPolicy, hostShellRefusal } = await import('../lib/policy.js')
const suite = createSuite('policy')

suite.test('the published name keeps the ops_ namespace', () => {
  assert.equal(TOOL_PREFIX, 'ops_')
  assert.equal(publicToolName('bash'), 'ops_bash')
  assert.equal(BASH_TOOL, 'ops_bash')
  assert.equal(TOOLING_SECTION, 'dsh-bash:shell-routing')
  assert.equal(SECTION_ORDERS[TOOLING_SECTION], 3251)
})

suite.test('a bash-only surface renders one table row and the argument rules', () => {
  const text = renderToolingPolicy({ published: ['ops_bash'] })
  assert.match(text, /^# Shell routing: ops_bash -> host PowerShell/)
  assert.match(text, /\| General commands .* \| ops_bash \|/)
  assert.equal(/pwsh \(host PowerShell\)/.test(text), false)
  assert.match(text, /ops_\* arguments are strict/)
  assert.match(text, /script_path/)
})

suite.test('a visible host pwsh is advertised as the Windows-native rung only', () => {
  const text = renderToolingPolicy({ published: ['ops_bash', 'pwsh'] })
  assert.match(text, /Windows-native cmdlets .* pwsh \(host PowerShell\)/)
})

suite.test('pwsh alone still renders a section, without the bash rules', () => {
  const text = renderToolingPolicy({ published: ['pwsh'] })
  assert.match(text, /^# Windows-native shell/)
  assert.equal(/Prefer ops_bash/.test(text), false)
})

suite.test('an empty surface renders nothing at all', () => {
  assert.equal(renderToolingPolicy({ published: [] }), '')
  assert.equal(renderToolingPolicy({}), '')
  assert.equal(renderToolingPolicy(), '')
})

suite.test('shellComponent:false drops the host PowerShell claim', () => {
  assert.equal(renderToolingPolicy({ published: ['pwsh'], shellComponent: false }), '')
})

suite.test('the mounted shortcut advertises bash for a deployment that mounted it', () => {
  assert.match(renderToolingPolicy({ mounted: true }), /ops_bash/)
  assert.match(renderToolingPolicy({ levels: { bash: true } }), /ops_bash/)
})

suite.test('extra guidance is appended verbatim, and blank guidance adds nothing', () => {
  const text = renderToolingPolicy({ published: ['ops_bash'], extraGuidance: 'Use a scratch dir.' })
  assert.match(text, /\n\nUse a scratch dir\.$/)
  assert.equal(renderToolingPolicy({ published: ['ops_bash'], extraGuidance: '   ' }).endsWith('\n'), false)
})

suite.test('the refused host tool gets a reason naming the policy and the alternative', () => {
  const refusal = hostShellRefusal({ toolName: 'pwsh', denied: new Set(['pwsh']) })
  assert.equal(refusal.kind, 'deny')
  assert.match(refusal.reason, /Host tool pwsh is disabled by dsh-bash shellPolicy/)
  assert.match(refusal.reason, /ops_bash/)
})

suite.test('an unlisted tool is not refused', () => {
  assert.equal(hostShellRefusal({ toolName: 'read_file', denied: new Set(['pwsh']) }), undefined)
  assert.equal(hostShellRefusal({ toolName: 'pwsh', denied: new Set() }), undefined)
})

await suite.run()
