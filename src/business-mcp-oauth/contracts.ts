/** Non-secret, immutable resource authority. It never contains an API key or bearer. */
export type OAuthGrantFence=Readonly<{tokenId:string;bindingId:string;bindingRevision:number;expiresAt:number;policy?:'all-personal-business-v1'}>;
export function sameOAuthFence(a:OAuthGrantFence|undefined,b:OAuthGrantFence|undefined):boolean{
 return a===undefined?b===undefined:!!b&&a.tokenId===b.tokenId&&a.bindingId===b.bindingId&&a.bindingRevision===b.bindingRevision&&a.expiresAt===b.expiresAt&&a.policy===b.policy;
}
