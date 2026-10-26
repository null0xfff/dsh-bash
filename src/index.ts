/**
 * The standalone bash component: `ops_bash` over the plugin's own resolved bash.
 *
 * Extracted from `dsh-bash/src/index.ts` + `src/components/shell/index.ts` (MIT,
 * dsh-bash 0.4.1). Everything the original package mounted for file, PTC,
 * discovery, panel and TUI rows is gone; what remains is the shell half only:
 *
 * - resolve one bash rung (explicit path, provisioned copy, bundled copy, then
 *   optionally PATH / well-known installs);
 * - publish `ops_bash` per session, behind the host's own sandbox authority
 *   (`sandboxPolicy` + `subprocess` + `sandbox.confine`);
 * - render the shell routing prompt section;
 * - optionally deny the host's own shell tools (`shellPolicy: deny-host-shell`);
 * - on Windows, prepare the workspace ACL prerequisite that confined bash needs.
 *
 * No `@deepseek-ai/*` value import happens at load time: every host service is
 * reached through `ctx.get` / `ctx.inject`.
 *
 * @module dsh-bash
 */
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-system-prompt'
import { resolveConfig, type ResolvedConfig } from './config.js'
import { BASH_TOOL, SECTION_ORDERS, TOOLING_SECTION, hostShellRefusal, renderToolingPolicy } from './policy.js'
import { resolveShells } from './shells.js'
import { mountSessionBash } from './session-shells.js'
import { mountWorkspacePreparation } from './workspace-preparation.js'
import { visibleNames } from './surface.js'
import { safeDispose, safeDisposeAll } from './teardown.js'

export { resolveConfig, ConfigError } from './config.js'
export type { ResolvedConfig } from './config.js'
export { BASH_TOOL } from './policy.js'
export { resolveShells } from './shells.js'
export { bashToolDefinition, bashToolDescription } from './shells/tool.js'

export const name = 'dsh-bash'

function errorText(error: unknown): string {
  return String(error !== null && typeof error === 'object' && 'message' in error ? error.message ?? error : error)
}

function report(ctx: Context, message: string, level = 'error'): void {
  const logger = ctx?.logger
  const sink: unknown = logger ? Reflect.get(logger, level) : undefined
  if (typeof sink === 'function') sink.call(logger, message)
  else if (level === 'warn') console.warn(message)
  else console.error(message)
}

function visibleTools(ctx: Context, agent?: Agent): string[] {
  try {
    const tools = ctx.get('tools')
    return tools ? visibleNames(tools, agent) : []
  } catch { return [] }
}

/** Explicit host-shell denial is independent of whether this component publishes anything. */
function installHostShellDenial(ctx: Context, config: ResolvedConfig): void {
  const denied = new Set(config.deniedHostTools)
  const lifts = new Map<Agent, () => void>()
  let warned = false
  const hide = (agent: Agent) => {
    if (lifts.has(agent) || !agent?.ctx) return
    try {
      const names = visibleNames(ctx.tools, agent).filter(name => denied.has(name))
      if (names.length) lifts.set(agent, agent.ctx.tools.restrict({ deny: names }))
    } catch (error) {
      if (!warned) {
        warned = true
        report(ctx, `dsh-bash: host shell visibility restriction unavailable: ${errorText(error)}; calls remain denied.`, 'warn')
      }
    }
  }
  ctx.on('agent/created', ({ agent }) => { hide(agent) })
  ctx.on('agent/disposed', ({ agent }) => {
    safeDispose(lifts.get(agent), (error) => report(ctx, `dsh-bash: host shell restriction lift failed: ${errorText(error)}`, 'warn'), 'host shell lift (agent disposed)')
    lifts.delete(agent)
  })
  for (const agent of ctx.get('agents')?.list?.() ?? []) hide(agent)
  ctx.effect(() => () => {
    safeDisposeAll(lifts.values(), (error) => report(ctx, `dsh-bash: host shell restriction lift failed: ${errorText(error)}`, 'warn'), 'host shell lift')
    lifts.clear()
  }, 'dsh-bash: host shell restrictions')
  ctx.on('tools/pre-execute', async (exec, next) => {
    const refusal = hostShellRefusal({ toolName: String(exec?.name ?? ''), denied })
    return refusal ? { kind: 'deny', reason: refusal.reason } : next()
  })
  if (typeof ctx.tools.guard === 'function') {
    ctx.effect(() => ctx.tools.guard(exec => hostShellRefusal({ toolName: String(exec?.name ?? ''), denied })?.reason), 'dsh-bash: host shell guard')
  }
}

/** Component row entry: mount the shell half only. */
export function apply(root: Context, rawConfig: unknown): void {
  const config = resolveConfig(rawConfig ?? {})
  const shells = resolveShells(config)

  if (config.promptPolicy) {
    root.inject(['systemPrompt'], ctx => {
      ctx.effect(() => ctx.systemPrompt.section({
        name: `${TOOLING_SECTION}`,
        order: SECTION_ORDERS[TOOLING_SECTION],
        interpolate: false,
        text: context => renderToolingPolicy({
          published: visibleTools(ctx, context.agent).filter(toolName => toolName === BASH_TOOL || toolName === 'pwsh'),
          shellComponent: true,
          extraGuidance: config.extraGuidance,
        }),
      }), 'dsh-bash: shell routing')
    })
  }

  const level = shells.bash.available ? 'info' : 'warn'
  report(root, shells.bash.available
    ? `dsh-bash: bash resolved from ${shells.bash.source} (${shells.bash.file})`
    : `dsh-bash: bash unavailable: ${shells.bash.detail}`, level)

  // Windows needs its workspace ACL prerequisite before any confined command.
  if (process.platform === 'win32') mountWorkspacePreparation(root)
  root.inject(['tools'], ctx => {
    mountSessionBash(ctx, config, shells)
    if (config.shellPolicy === 'deny-host-shell') installHostShellDenial(ctx, config)
  })
}
