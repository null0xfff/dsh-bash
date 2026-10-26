/** The visible tool names of one scope, without copying any schema.
 *
 * Trimmed copy of `dsh-bash/src/surface.ts` `visibleNames` (MIT, dsh-bash 0.4.1):
 * `schemas()` deep-copies every definition's parameters just to hand back names;
 * the scope view reports the same names in view order for far less work, and a host
 * without a reachable view falls back to the projection.
 */
import type { Agent } from '@deepseek-ai/dsh-agent'
import type ToolRuntime from '@deepseek-ai/dsh-tools'

interface ScopeView {
  visible?: {
    entries?: () => Iterable<[string, unknown]>
    keys?: () => Iterable<string>
  }
}
type Viewable = { view?: (scope?: object) => ScopeView | undefined }

export const visibleNames = (tools: Pick<ToolRuntime, 'schemas'>, scope?: object): string[] => {
  const visible = (tools as unknown as Viewable).view?.(scope)?.visible
  if (typeof visible?.keys === 'function') return [...visible.keys()]
  return tools.schemas(scope as Agent).map(schema => schema.name)
}
