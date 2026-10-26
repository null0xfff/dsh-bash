/**
 * The component row the DSH Loader mounts (`dsh-bash/shell`).
 *
 * Trimmed from `dsh-ops/src/components/shell/index.ts` (MIT, dsh-ops 0.4.1): the
 * settings-form projection and the file/PTC/pwsh wiring are gone, so this row is
 * nothing but the bash half.
 *
 * There is deliberately no `Config` export. The Loader validates a row against the
 * module's exported `Config` as a schemastery-shaped schema; a plain function there
 * fails activation with `Cannot read properties of undefined (reading 'validate')`
 * (observed on the real host). Validation therefore happens in `apply`, where an
 * invalid row is reported as an activation failure with this package's own message,
 * and unknown keys still fail loud instead of being silently dropped.
 */
import type { Context } from '@deepseek-ai/cordis'
import { apply as mountBash } from '../../index.js'

export const name = 'dsh-bash'

export function apply(ctx: Context, config: unknown): void {
  mountBash(ctx, config ?? {})
}
