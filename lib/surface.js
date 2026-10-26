export const visibleNames = (tools, scope) => {
    const visible = tools.view?.(scope)?.visible;
    if (typeof visible?.keys === 'function')
        return [...visible.keys()];
    return tools.schemas(scope).map(schema => schema.name);
};
