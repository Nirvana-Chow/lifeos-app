import {mcp} from '@better-auth/mcp';
import {cimd} from '@better-auth/cimd';
import {fetchClientMetadataResource} from '@better-auth/cimd/node';
import {jwt} from 'better-auth/plugins/jwt';
import type {BusinessOAuthConfig} from './boundary.ts';
import type {PlatformConfig} from '../platform/config.ts';
export const oauthConsentReference='lifeos-business-mcp-v1';
export const oauthModelNames={oauthClient:'platform_oauth_client',oauthResource:'platform_oauth_resource',oauthClientResource:'platform_oauth_client_resource',oauthRefreshToken:'platform_oauth_refresh_token',oauthAccessToken:'platform_oauth_access_token',oauthConsent:'platform_oauth_consent',oauthClientAssertion:'platform_oauth_client_assertion'} as const;
export function businessOAuthPlugins(config:PlatformConfig,oauth:BusinessOAuthConfig){
 const ready=(user:Record<string,unknown>,session:Record<string,unknown>)=>user.id===config.ownerId&&typeof user.email==='string'&&user.email.toLowerCase()===config.ownerEmail.toLowerCase()&&user.twoFactorEnabled===true&&session.userId===config.ownerId&&session.mfaVerified===true;
 return [jwt({disableSettingJwtHeader:true,jwt:{issuer:oauth.issuer},schema:{jwks:{modelName:'platform_oauth_jwks'}}}),
  mcp({resource:oauth.resource,loginPage:'/login',consentPage:'/personal/oauth',scopes:[...oauth.scopes],grantTypes:['authorization_code','refresh_token'],accessTokenExpiresIn:300,refreshTokenExpiresIn:7*86400,refreshTokenReuseInterval:0,
   allowDynamicClientRegistration:false,allowUnauthenticatedClientRegistration:false,allowClientKeyRotation:false,allowPublicClientPrelogin:false,clientRegistrationRequirePKCE:true,
   clientRegistrationDefaultScopes:[...oauth.scopes],clientRegistrationAllowedScopes:[...oauth.scopes],clientRegistrationAllowedResources:[oauth.resource],enforcePerClientResources:true,
   schema:Object.fromEntries(Object.entries(oauthModelNames).map(([key,modelName])=>[key,{modelName}])),
   postLogin:{page:'/personal/oauth/continue',shouldRedirect:async({user,session})=>!ready(user,session),consentReferenceId:async({user,session})=>{if(!ready(user,session))throw Error('OWNER_MFA_REQUIRED');return oauthConsentReference;}},
   customAccessTokenClaims:async({user,referenceId,resources})=>{if(!user||user.id!==config.ownerId||referenceId!==oauthConsentReference||resources?.length!==1||resources[0]!==oauth.resource)throw Error('OAUTH_BUSINESS_BINDING_REQUIRED');return{lifeos_policy:'business-mcp-v1'};},
  }),cimd({fetchClientMetadataResource,metadataProfile:'mcp-2026-07-28',maxCacheEntries:32,metadataFetchPolicy:{maximumConcurrentFetches:2,maximumConcurrentFetchesPerOrigin:1,maximumFetchesPerMinute:30,maximumFetchesPerOriginPerMinute:10}})];
}
