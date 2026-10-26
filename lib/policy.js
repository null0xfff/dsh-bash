/**
 * The bash component's model-facing routing policy.
 *
 * Ported from `dsh-ops/src/policy.ts` (MIT, dsh-ops 0.4.1), reduced to the one
 * rung this package owns: `ops_bash` over the plugin's resolved bash. The host
 * keeps owning PowerShell, so that row is only advertised when the host's own
 * tool is visible.
 *
 * @module dsh-bash/policy
 */
/** Model-facing routing, kept in one prompt section. */
export const TOOLING_SECTION = 'dsh-bash:shell-routing';
export const SECTION_ORDERS = Object.freeze({ [TOOLING_SECTION]: 3251 });
export const TOOL_PREFIX = 'ops_';
/** Raw tool names this component registers itself. */
export const IN_PROCESS_TOOLS = Object.freeze(['bash']);
/** Prefix one raw tool name with the published namespace. */
export function publicToolName(rawName) {
    return `${TOOL_PREFIX}${rawName}`;
}
/** The model-facing name of the tool this package publishes. */
export const BASH_TOOL = publicToolName(IN_PROCESS_TOOLS[0]);
/**
 * Render the routing table for whichever of the two shells is really visible.
 * Absent tools are never advertised, and a deployment with neither produces no section.
 */
export function renderToolingPolicy({ published, mounted, levels, shellComponent = true, extraGuidance = '', } = {}) {
    const names = new Set(published ?? (mounted || levels?.bash ? [BASH_TOOL] : []));
    if (levels?.pwsh)
        names.add('pwsh');
    if (!shellComponent)
        names.delete('pwsh');
    const hasBash = names.has(BASH_TOOL);
    const hasPwsh = names.has('pwsh');
    if (!hasBash && !hasPwsh)
        return '';
    const heading = hasBash ? `# Shell routing: ${BASH_TOOL} -> host PowerShell` : '# Windows-native shell';
    const lines = [heading, '', '| Task | Tool |', '| --- | --- |'];
    if (hasBash)
        lines.push(`| General commands / builds / git / pipelines / scripts - preferred command executor | ${BASH_TOOL} |`);
    if (hasPwsh)
        lines.push('| Windows-native cmdlets / registry / services only | pwsh (host PowerShell) |');
    if (hasBash) {
        lines.push(`- Prefer ${BASH_TOOL} for command execution. Use PowerShell only when Windows-native functionality is necessary; fix ${BASH_TOOL} errors in ${BASH_TOOL}, do not switch shells or mix their syntax.`, '- Use command only for short commands and pipelines. For scripts longer than about 1 KB or containing heredocs, quotes, backslashes or non-ASCII text, write the script to a file first and pass script_path.', `- ${BASH_TOOL} requires description and returns kind foreground, background or promoted. Foreground has status (completed/failed), exitCode, stdout/stderr and error; background/promoted has jobId for host job_output/job_kill. Failures, including invalid arguments, return values with failure.code, failure.effectState and failure.retry; inspect unknown effects before repeating.`, '- ops_* arguments are strict: pass only declared fields.');
    }
    if (extraGuidance.trim())
        lines.push('', extraGuidance.trim());
    return lines.join('\n');
}
/** Explicit deny policy applies even when this component publishes nothing. */
export function hostShellRefusal({ toolName, denied }) {
    if (!denied.has(toolName))
        return undefined;
    return {
        kind: 'deny',
        reason: `Host tool ${toolName} is disabled by dsh-bash shellPolicy. Use ${BASH_TOOL} for commands; otherwise request an operator policy change.`,
    };
}
