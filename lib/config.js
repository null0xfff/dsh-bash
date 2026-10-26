/**
 * Configuration for the standalone bash component.
 *
 * Ported from `dsh-bash/src/config.ts` (MIT, dsh-bash 0.4.1) and reduced to the keys
 * the bash row actually reads. Validation stays explicit and loud: an unknown key
 * is an error that names it, and the host half still imports no `@deepseek-ai/*`
 * value at load time.
 *
 * @module dsh-bash/config
 */
export class ConfigError extends Error {
    constructor(message) {
        super(message);
        this.name = 'ConfigError';
    }
}
/**
 * Keys earlier `dsh-bash` releases wrote into saved rows. They are still accepted
 * and type-checked so a row copied from that plugin loads, but they are never
 * returned and this component ignores them.
 */
export const LEGACY_KEYS = Object.freeze(['serverName', 'enableShellTools', 'toolCallTimeoutMs']);
export const CORE_CONFIG_KEYS = Object.freeze([
    ...LEGACY_KEYS,
    'configUpdateVersion',
    'bashPath',
    'publishBashTool',
    'shellPolicy',
    'deniedHostTools',
    'promptPolicy',
    'extraGuidance',
    'allowSystemShellFallback',
]);
/** Upper bound accepted for the legacy `toolCallTimeoutMs`, matching the loader's timer ceiling. */
const MAX_TOOL_CALL_TIMEOUT_MS = 2_147_483_647;
/** How the component treats the host's own shell tools. */
export const SHELL_POLICIES = ['advise', 'deny-host-shell'];
/** Host tool names the `deny-host-shell` policy refuses by default. */
export const DEFAULT_DENIED_HOST_TOOLS = ['pwsh', 'bash', 'pwsh_persistent'];
function rejectUnknownKeys(raw, known) {
    const unknown = Object.keys(raw).filter((key) => !known.includes(key));
    if (unknown.length > 0) {
        throw new ConfigError(`unknown key(s) ${unknown.map((key) => JSON.stringify(key)).join(', ')}; `
            + `accepted keys are ${known.map((key) => JSON.stringify(key)).join(', ')}`);
    }
}
function optionalString(raw, key) {
    const value = raw[key];
    if (value === undefined || value === null)
        return undefined;
    if (typeof value !== 'string' || value.trim() === '') {
        throw new ConfigError(`${key} must be a non-empty string, got ${JSON.stringify(value)}`);
    }
    return value;
}
function optionalBoolean(raw, key, fallback) {
    const value = raw[key];
    if (value === undefined || value === null)
        return fallback;
    if (typeof value !== 'boolean') {
        throw new ConfigError(`${key} must be a boolean, got ${JSON.stringify(value)}`);
    }
    return value;
}
function optionalStringList(raw, key, fallback) {
    const value = raw[key];
    if (value === undefined || value === null)
        return [...fallback];
    if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string' || entry.trim() === '')) {
        throw new ConfigError(`${key} must be an array of non-empty strings, got ${JSON.stringify(value)}`);
    }
    return [...value];
}
/**
 * Validate one component row's config.
 * @param rawConfig - the `config` value from the loader row.
 * @returns the resolved configuration.
 */
export function resolveConfig(rawConfig) {
    if (rawConfig === undefined || rawConfig === null)
        rawConfig = {};
    if (typeof rawConfig !== 'object' || Array.isArray(rawConfig)) {
        throw new ConfigError(`config must be an object, got ${JSON.stringify(rawConfig)}`);
    }
    const raw = rawConfig;
    rejectUnknownKeys(raw, CORE_CONFIG_KEYS);
    const configUpdateVersion = raw.configUpdateVersion ?? 0;
    if (typeof configUpdateVersion !== 'number' || !Number.isSafeInteger(configUpdateVersion) || configUpdateVersion < 0) {
        throw new ConfigError('configUpdateVersion must be a non-negative safe integer');
    }
    // Legacy keys: validated exactly as before so a malformed row still fails loud, then dropped.
    const serverName = optionalString(raw, 'serverName');
    if (serverName !== undefined && !/^[A-Za-z0-9_-]{1,32}$/.test(serverName)) {
        throw new ConfigError(`serverName must match [A-Za-z0-9_-]{1,32}, got ${JSON.stringify(serverName)}`);
    }
    optionalBoolean(raw, 'enableShellTools', true);
    const timeout = raw.toolCallTimeoutMs;
    if (timeout !== undefined && timeout !== null
        && (!Number.isFinite(timeout) || Number(timeout) <= 0 || Number(timeout) > MAX_TOOL_CALL_TIMEOUT_MS)) {
        throw new ConfigError(`toolCallTimeoutMs must be a positive finite number of milliseconds, got ${JSON.stringify(timeout)}`);
    }
    const shellPolicy = optionalString(raw, 'shellPolicy') ?? 'advise';
    if (!SHELL_POLICIES.includes(shellPolicy)) {
        throw new ConfigError(`shellPolicy must be one of ${SHELL_POLICIES.map((value) => JSON.stringify(value)).join(', ')}, `
            + `got ${JSON.stringify(shellPolicy)}`);
    }
    return {
        configUpdateVersion,
        shellPolicy: shellPolicy,
        deniedHostTools: optionalStringList(raw, 'deniedHostTools', DEFAULT_DENIED_HOST_TOOLS),
        promptPolicy: optionalBoolean(raw, 'promptPolicy', true),
        extraGuidance: optionalString(raw, 'extraGuidance') ?? '',
        bashPath: optionalString(raw, 'bashPath'),
        publishBashTool: optionalBoolean(raw, 'publishBashTool', true),
        // Ambient system bash requires explicit operator opt-in on Windows. On POSIX the
        // machine's own bash IS the rung, so the gate is skipped there (see shells/resolve.ts).
        allowSystemShellFallback: optionalBoolean(raw, 'allowSystemShellFallback', false),
    };
}
