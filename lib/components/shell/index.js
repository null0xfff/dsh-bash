import { apply as mountBash } from '../../index.js';
export const name = 'dsh-bash';
export function apply(ctx, config) {
    mountBash(ctx, config ?? {});
}
