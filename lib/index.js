import { resolveConfig } from './config.js';
import { BASH_TOOL, SECTION_ORDERS, TOOLING_SECTION, hostShellRefusal, renderToolingPolicy } from './policy.js';
import { resolveShells } from './shells.js';
import { mountSessionBash } from './session-shells.js';
import { mountWorkspacePreparation } from './workspace-preparation.js';
import { visibleNames } from './surface.js';
import { safeDispose, safeDisposeAll } from './teardown.js';
export { resolveConfig, ConfigError } from './config.js';
export { BASH_TOOL } from './policy.js';
export { resolveShells } from './shells.js';
export { bashToolDefinition, bashToolDescription } from './shells/tool.js';
export const name = 'dsh-bash';
function errorText(error) {
    return String(error !== null && typeof error === 'object' && 'message' in error ? error.message ?? error : error);
}
function report(ctx, message, level = 'error') {
    const logger = ctx?.logger;
    const sink = logger ? Reflect.get(logger, level) : undefined;
    if (typeof sink === 'function')
        sink.call(logger, message);
    else if (level === 'warn')
        console.warn(message);
    else
        console.error(message);
}
function visibleTools(ctx, agent) {
    try {
        const tools = ctx.get('tools');
        return tools ? visibleNames(tools, agent) : [];
    }
    catch {
        return [];
    }
}
/** Explicit host-shell denial is independent of whether this component publishes anything. */
function installHostShellDenial(ctx, config) {
    const denied = new Set(config.deniedHostTools);
    const lifts = new Map();
    let warned = false;
    const hide = (agent) => {
        if (lifts.has(agent) || !agent?.ctx)
            return;
        try {
            const names = visibleNames(ctx.tools, agent).filter(name => denied.has(name));
            if (names.length)
                lifts.set(agent, agent.ctx.tools.restrict({ deny: names }));
        }
        catch (error) {
            if (!warned) {
                warned = true;
                report(ctx, `dsh-bash: host shell visibility restriction unavailable: ${errorText(error)}; calls remain denied.`, 'warn');
            }
        }
    };
    ctx.on('agent/created', ({ agent }) => { hide(agent); });
    ctx.on('agent/disposed', ({ agent }) => {
        safeDispose(lifts.get(agent), (error) => report(ctx, `dsh-bash: host shell restriction lift failed: ${errorText(error)}`, 'warn'), 'host shell lift (agent disposed)');
        lifts.delete(agent);
    });
    for (const agent of ctx.get('agents')?.list?.() ?? [])
        hide(agent);
    ctx.effect(() => () => {
        safeDisposeAll(lifts.values(), (error) => report(ctx, `dsh-bash: host shell restriction lift failed: ${errorText(error)}`, 'warn'), 'host shell lift');
        lifts.clear();
    }, 'dsh-bash: host shell restrictions');
    ctx.on('tools/pre-execute', async (exec, next) => {
        const refusal = hostShellRefusal({ toolName: String(exec?.name ?? ''), denied });
        return refusal ? { kind: 'deny', reason: refusal.reason } : next();
    });
    if (typeof ctx.tools.guard === 'function') {
        ctx.effect(() => ctx.tools.guard(exec => hostShellRefusal({ toolName: String(exec?.name ?? ''), denied })?.reason), 'dsh-bash: host shell guard');
    }
}
/** Component row entry: mount the shell half only. */
export function apply(root, rawConfig) {
    const config = resolveConfig(rawConfig ?? {});
    const shells = resolveShells(config);
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
            }), 'dsh-bash: shell routing');
        });
    }
    const level = shells.bash.available ? 'info' : 'warn';
    report(root, shells.bash.available
        ? `dsh-bash: bash resolved from ${shells.bash.source} (${shells.bash.file})`
        : `dsh-bash: bash unavailable: ${shells.bash.detail}`, level);
    // Windows needs its workspace ACL prerequisite before any confined command.
    if (process.platform === 'win32')
        mountWorkspacePreparation(root);
    root.inject(['tools'], ctx => {
        mountSessionBash(ctx, config, shells);
        if (config.shellPolicy === 'deny-host-shell')
            installHostShellDenial(ctx, config);
    });
}
