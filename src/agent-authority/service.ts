import {normalizeOperationGrantScopes} from '../agent-api/business-policy.ts';
import type {OperationScope} from '../agent-api/personal-operation-registry.ts';
import {agentCapabilityOperations as agentOperations} from '../agent-api/capabilities.ts';
import type {AuthoritySourceRef,TrustedActor,TrustedAgentActor,TrustedOwnerActor} from './contracts.ts';
type Owner = Readonly<{ownerId:string;spaceId:string;sessionRef:string}>;
type Agent = Readonly<{ownerId:string;spaceId:string;grantId:string;scopes:readonly OperationScope[];authorizationRevision?:string;businessDataPolicy?:'all-personal-business-v1';allowedOperationIds?:readonly string[]}>;
type Deps = Readonly<{ownerId:string;spaceId:string;verifyOwner:(headers:Headers)=>Promise<Owner|null>;verifyAgent:(key:string)=>Promise<Agent|null>;readCurrentAgent?:(grantId:string)=>Promise<Agent|null>}>;
export class AuthorityService {
  private readonly issued = new WeakMap<object, () => Promise<Owner|Agent|null>>();
  private readonly deps: Deps;
  constructor(deps: Deps) {this.deps = deps;}
  private bound(value: Owner|Agent|null): boolean {return !!value && value.ownerId === this.deps.ownerId && value.spaceId === this.deps.spaceId;}
  async resolveOwnerActor(headers: Headers): Promise<TrustedOwnerActor|null> {
    const snapshot = new Headers(headers);
    const check = () => this.deps.verifyOwner(new Headers(snapshot));
    const owner = await check();
    if (!this.bound(owner) || !owner?.sessionRef) return null;
    const actor = Object.freeze({kind:'owner-session',...owner}) as TrustedOwnerActor;
    this.issued.set(actor, check); return actor;
  }
  async resolveAgentActor(key: string): Promise<TrustedAgentActor|null> {
    const grant = await this.deps.verifyAgent(key);
    if (!this.bound(grant) || !grant?.grantId) return null;
    let scopes: readonly OperationScope[];
    try {scopes = normalizeOperationGrantScopes(grant);} catch {return null;}
    const actor = Object.freeze({kind:'agent-grant',ownerId:grant.ownerId,spaceId:grant.spaceId,grantId:grant.grantId,scopes,...(grant.businessDataPolicy?{businessDataPolicy:grant.businessDataPolicy,allowedOperationIds:Object.freeze([...(grant.allowedOperationIds??[])])}:{})}) as TrustedAgentActor;
    this.issued.set(actor, () => this.deps.readCurrentAgent?.(grant.grantId) ?? Promise.resolve(null)); return actor;
  }
  /** Non-secret producer snapshot, read only while the caller holds its grant fence. */
  async currentProducerRevision(grantId:string):Promise<string|null>{
    const current=await this.deps.readCurrentAgent?.(grantId);
    return this.bound(current??null)&&current?.grantId===grantId&&typeof current.authorizationRevision==='string'&&/^[a-f0-9]{64}$/.test(current.authorizationRevision)?current.authorizationRevision:null;
  }
  /** Snapshot the producer's current policy before acquiring the same-row fence. */
  async currentProducerBinding(grantId:string){
    const current=await this.deps.readCurrentAgent?.(grantId);
    if(!this.bound(current??null)||current?.grantId!==grantId)return null;
    return {grantId,ownerId:current.ownerId,spaceId:current.spaceId,...(current.businessDataPolicy?{businessDataPolicy:current.businessDataPolicy}:{})};
  }
  async assertCurrentAuthority(actor: TrustedActor, operationId: string, sourceRefs: readonly AuthoritySourceRef[] = []): Promise<void> {
    const check = this.issued.get(actor);
    // Server-owned policy only; private owner review/approval never enters Agent discovery.
    const operation = actor.kind === 'owner-session' && ['reviewTodoClassification','approveTodoClassification','previewSelectionTodoClassification'].includes(operationId)
      ? {requiredScopes:[] as readonly OperationScope[]} : agentOperations.find(entry => entry.id === operationId);
    if (!check || !operation || sourceRefs.length) throw Error('Authority unavailable');
    const current = await check();
    if (!this.bound(current)) throw Error('Authority unavailable');
    if (actor.kind === 'owner-session') {
      if (!current || !('sessionRef' in current) || current.sessionRef !== actor.sessionRef) throw Error('Authority unavailable');
    } else if (actor.kind === 'agent-grant') {
      if (!current || !('grantId' in current) || current.grantId !== actor.grantId) throw Error('Authority unavailable');
      let scopes: readonly OperationScope[];
      try {scopes = normalizeOperationGrantScopes(current);} catch {throw Error('Authority unavailable');}
      if (current.businessDataPolicy!==actor.businessDataPolicy || current.businessDataPolicy && operationId!=='discoverV2' && operationId!=='discover' && (!current.allowedOperationIds?.includes(operationId)||!actor.allowedOperationIds?.includes(operationId)) || scopes.join(',') !== actor.scopes.join(',') || !operation.requiredScopes.every(scope => scopes.includes(scope))) throw Error('Authority unavailable');
    } else throw Error('Authority unavailable');
  }
}
