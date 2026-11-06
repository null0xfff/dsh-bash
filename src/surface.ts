/** Inspect registered tool names through the public host API, preserving scoped visibility. */
import type { Agent } from '@deepseek-ai/dsh-agent'
import type ToolRuntime from '@deepseek-ai/dsh-tools'

type Inspectable = { definitions?: (scope?: object) => readonly { name: string }[] }

export const visibleNames = (tools: Pick<ToolRuntime, 'schemas'>, scope?: object): string[] => {
  const inspect = tools as unknown as Inspectable
  if (typeof inspect.definitions === 'function') return inspect.definitions(scope).map(definition => definition.name)
  return tools.schemas(scope as Agent).map(schema => schema.name)
}
