export const allPersonalBusinessOAuthScope='personal-business:all' as const;
const fullPolicyScopes=new Set<string>([allPersonalBusinessOAuthScope,'offline_access','file-handoff:read','file-handoff:write']);

/** An explicit full business grant may include separate file consent and offline access. */
export function fullBusinessOAuthScopes(scopes:readonly string[]):boolean{
 return scopes.includes(allPersonalBusinessOAuthScope)
  && new Set(scopes).size===scopes.length
  && scopes.every(scope=>fullPolicyScopes.has(scope))
  && (!scopes.includes('file-handoff:write')||scopes.includes('file-handoff:read'));
}
