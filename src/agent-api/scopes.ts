export const agentScopes = ['todo:read','todo:write','organization:read','organization:write','requirements:read','requirements:write'] as const;
export type AgentScope = typeof agentScopes[number];
export type AgentPermissions = Readonly<{todo?: readonly ('read'|'write')[]; organization?: readonly ('read'|'write')[];requirements?: readonly ('read'|'write')[]}>;

export function normalizeAgentScopes(value: unknown): readonly AgentScope[] {
  if (!Array.isArray(value) || !value.length || value.some(x => !agentScopes.includes(x)) || new Set(value).size !== value.length)
    throw Error('Invalid Agent scopes');
  for (const domain of ['todo','organization','requirements'])
    if (value.includes(`${domain}:write`) && !value.includes(`${domain}:read`)) throw Error('Invalid Agent scopes');
  return Object.freeze(agentScopes.filter(scope => value.includes(scope)));
}
export function encodeAgentPermissions(scopes: readonly AgentScope[]): AgentPermissions {
  const normalized = normalizeAgentScopes(scopes);
  const result: {todo?: ('read'|'write')[]; organization?: ('read'|'write')[];requirements?: ('read'|'write')[]} = {};
  for (const domain of ['todo','organization','requirements'] as const) {
    if (normalized.includes(`${domain}:read`)) result[domain] = normalized.includes(`${domain}:write`) ? ['read','write'] : ['read'];
  }
  return result;
}
export function decodeAgentPermissions(value: unknown): readonly AgentScope[] | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const entries = Object.entries(value);
  if (!entries.length || entries.some(([key, actions]) => !['todo','organization','requirements'].includes(key) || !Array.isArray(actions) ||
      !(actions.length === 1 && actions[0] === 'read' || actions.length === 2 && actions[0] === 'read' && actions[1] === 'write'))) return null;
  try { return normalizeAgentScopes(entries.flatMap(([key, actions]) => (actions as string[]).map(action => `${key}:${action}`))); }
  catch { return null; }
}
