import type {OAuthGrantFence} from '../business-mcp-oauth/contracts.ts';
import type {ClassificationPlan} from './classification-contracts.ts';
import {PlatformError} from '../platform/domain.ts';
/** Private producer ledger. Never added to the original plan/API wire shape. */
export type ClassificationOAuthProducer=Readonly<{schemaVersion:1;ownerId:string;spaceId:string;grantId:string;planId:string;digest:string;proposalRevision:1;expiresAt:string;producerAuthorizationRevision:string;oauthFence:OAuthGrantFence}>;
export const isOAuthProducerRevision=(value:unknown):value is string=>typeof value==='string'&&/^classification-oauth-v1:[a-f0-9]{64}$/.test(value);
const unavailable=():never=>{throw new PlatformError(403,'CLASSIFICATION_AUTHORITY','分类来源授权已失效。');};
export function classificationOAuthProducer(plan:ClassificationPlan,fence:OAuthGrantFence):ClassificationOAuthProducer{
 if(!plan.grantId||!isOAuthProducerRevision(plan.producerAuthorizationRevision)||fence.policy!=='all-personal-business-v1'||Date.parse(plan.preview.expiresAt)>fence.expiresAt*1000)return unavailable();
 return{schemaVersion:1,ownerId:plan.ownerId,spaceId:plan.spaceId,grantId:plan.grantId,planId:plan.preview.planId,digest:plan.preview.digest,proposalRevision:plan.proposalRevision,expiresAt:plan.preview.expiresAt,producerAuthorizationRevision:plan.producerAuthorizationRevision,oauthFence:{...fence}};
}
export function assertClassificationOAuthProducer(value:unknown,plan:ClassificationPlan):ClassificationOAuthProducer{
 if(!value||typeof value!=='object'||Array.isArray(value))return unavailable();const v=value as ClassificationOAuthProducer,f=v.oauthFence;
 if(Object.keys(v).sort().join(',')!==['schemaVersion','ownerId','spaceId','grantId','planId','digest','proposalRevision','expiresAt','producerAuthorizationRevision','oauthFence'].sort().join(',')||!f||Object.keys(f).sort().join(',')!==['tokenId','bindingId','bindingRevision','expiresAt','policy'].sort().join(',')||typeof f.tokenId!=='string'||!/^[a-f0-9]{64}$/.test(f.tokenId)||typeof f.bindingId!=='string'||!f.bindingId||!Number.isSafeInteger(f.bindingRevision)||f.bindingRevision<1||!Number.isSafeInteger(f.expiresAt)||f.policy!=='all-personal-business-v1')return unavailable();
 const expected=classificationOAuthProducer(plan,f);
 if(v.schemaVersion!==1||v.ownerId!==expected.ownerId||v.spaceId!==expected.spaceId||v.grantId!==expected.grantId||v.planId!==expected.planId||v.digest!==expected.digest||v.proposalRevision!==expected.proposalRevision||v.expiresAt!==expected.expiresAt||v.producerAuthorizationRevision!==expected.producerAuthorizationRevision)return unavailable();
 return expected;
}
