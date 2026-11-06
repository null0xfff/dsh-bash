export const visibleNames = (tools, scope) => {
    const inspect = tools;
    if (typeof inspect.definitions === 'function')
        return inspect.definitions(scope).map(definition => definition.name);
    return tools.schemas(scope).map(schema => schema.name);
};
