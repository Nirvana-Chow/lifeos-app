import {verifyAgentBusinessReadiness,verifyAgentRequirementsReadiness} from './runtime.ts';
import {createHmac, timingSafeEqual} from 'node:crypto';
import {isHTTPSOrigin} from '../platform/config.ts';
import {PlatformError} from '../platform/domain.ts';
import {agentScopes, normalizeAgentScopes, encodeAgentPermissions, decodeAgentPermissions, type AgentScope} from './scopes.ts';

const role = 'lifeos_agent_key_manager';
const maxExpirySeconds = 365 * 86400;
export const issuerScopes=(mode?:'organization-v1'|'requirements-v1')=>agentScopes.filter(scope=>mode==='requirements-v1'||scope.startsWith('todo:')||mode==='organization-v1'&&scope.startsWith('organization:'));
const ownerSessionCookie = '__Secure-lifeos-platform-candidate.session_token';

export type KeySummary = Readonly<{
  grantDigest?: string;
  id: string;
  name: string;
  scopes: readonly AgentScope[];
  createdAt: string;
  expiresAt: string | null;
  status: 'active' | 'expired' | 'revoked';
}>;
export type KeyOperation = 'list'|'create'|'revoke'|'setScopes';
export type SetScopesInput = {id:string;expectedGrantDigest:string;scopes:readonly AgentScope[]};
type IssueInput = {name: string; scopes: AgentScope[]; expiresIn: number};
type Issued = {grant: KeySummary; key: string};
type KeyPage = {keys: KeySummary[]; nextCursor?: string};
const cursorPattern = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z)~([A-Za-z0-9_-]{1,80})$/;
type Dependencies = {
  authenticate: (cookie: string) => Promise<boolean>;
  list: (cursor?: string) => Promise<KeyPage>;
  issue: (input: IssueInput) => Promise<Issued>;
  revoke: (id: string) => Promise<boolean>;
  setScopes?: (input:SetScopesInput,cookie:string) => Promise<KeySummary>;
};
type Result = {status: number; body?: unknown};

function fields(body: unknown, expected: readonly string[]): Record<string, unknown> | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const record = body as Record<string, unknown>;
  return Object.keys(record).length === expected.length && expected.every(key => Object.hasOwn(record,key)) ? record : null;
}

function safeSummary(value: KeySummary): KeySummary {
  const {id,name,scopes,createdAt,expiresAt,status,grantDigest} = value;
  return {id,name,scopes,createdAt,expiresAt,status,...(grantDigest?{grantDigest}:{})};
}

export function createKeyIssuer(deps: Dependencies, clock = Date.now, businessScopes?:'organization-v1'|'requirements-v1') {
  return async (operation: KeyOperation, cookie: string, body: unknown): Promise<Result> => {
    const fail = (status:number,error:string): Result => ({status,body:{error}});
    try {
      if (!cookie || Buffer.byteLength(cookie) > 8192 || !await deps.authenticate(cookie)) return fail(401,'AUTH_REQUIRED');
      if (operation === 'list') {
        const input = fields(body, ['cursor']);
        const cursor = input?.cursor;
        if (!fields(body, []) && (typeof cursor !== 'string' || !cursorPattern.test(cursor) || !Number.isFinite(Date.parse(cursor.split('~')[0]))))
          return fail(400, 'INVALID_REQUEST');
        const page = await deps.list(typeof cursor === 'string' ? cursor : undefined);
        return {status: 200, body: {keys: page.keys.map(safeSummary), ...(businessScopes?{availableScopes:issuerScopes(businessScopes)}:{}), ...(page.nextCursor ? {nextCursor: page.nextCursor} : {})}};
      }
      if (operation === 'revoke') {
        const input = fields(body,['id']);
        if (typeof input?.id !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(input.id)) return fail(400,'INVALID_REQUEST');
        return await deps.revoke(input.id) ? {status:204} : fail(404,'NOT_FOUND');
      }
      if (operation === 'setScopes') {
        if (!businessScopes || !deps.setScopes) return fail(503,'KEY_MANAGEMENT_UNAVAILABLE');
        const input=fields(body,['id','expectedGrantDigest','scopes']);
        if (typeof input?.id!=='string'||!/^[A-Za-z0-9_-]{1,80}$/.test(input.id)||
            typeof input.expectedGrantDigest!=='string'||!/^[a-f0-9]{64}$/.test(input.expectedGrantDigest)) return fail(400,'INVALID_REQUEST');
        let scopes:readonly AgentScope[];
        try {scopes=normalizeAgentScopes(input.scopes);if(scopes.some(s=>!issuerScopes(businessScopes).includes(s)))return fail(400,'INVALID_REQUEST');} catch {return fail(400,'INVALID_REQUEST');}
        const grant=await deps.setScopes({id:input.id,expectedGrantDigest:input.expectedGrantDigest,scopes},cookie);
        return {status:200,body:{grant:safeSummary(grant)}};
      }
      const input = fields(body,['name','scopes','expiresAt']) ?? fields(body,['name','scopes','expiresInDays']);
      const name = typeof input?.name === 'string' ? input.name.trim() : '';
      let scopes:readonly AgentScope[];
      try {scopes=normalizeAgentScopes(input?.scopes);} catch {return fail(400,'INVALID_REQUEST');}
      if (!name || name.length > 80 || /[\u0000-\u001f\u007f]/u.test(name) ||
          scopes.some(scope=>!issuerScopes(businessScopes).includes(scope))) return fail(400,'INVALID_REQUEST');
      let expiresIn: number;
      if (input && Object.hasOwn(input,'expiresInDays')) {
        const days=input.expiresInDays;
        if (typeof days!=='number' || ![7,30,90,365].includes(days)) return fail(400,'INVALID_EXPIRY');
        expiresIn=days*86400;
      } else {
        const raw=input?.expiresAt;
        if (typeof raw!=='string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(raw)) return fail(400,'INVALID_EXPIRY');
        const date=new Date(raw);
        const remaining=date.valueOf()-clock();
        const normalized=raw.length===20?raw.slice(0,-1)+'.000Z':raw;
        if (!Number.isFinite(remaining) || date.toISOString()!==normalized ||
            remaining<1000 || remaining>maxExpirySeconds*1000) return fail(400,'INVALID_EXPIRY');
        expiresIn=Math.floor(remaining/1000);
      }
      const issued=await deps.issue({name,scopes:scopes as AgentScope[],expiresIn});
      return {status:201,body:{grant:safeSummary(issued.grant),key:issued.key}};
    } catch (error) {
      if(error instanceof PlatformError)return fail(error.status,error.code);
      return fail(503,'KEY_MANAGEMENT_UNAVAILABLE');
    }
  };
}

// Better Auth's pinned signed session cookie is URL-encoded token + "." +
// padded base64 HMAC-SHA256. Never accept a bare token or a nonsecure alias.
export function readSignedOwnerSession(header: string, secret: string): string | null {
  const pairs=header.split(';').map(value=>value.trim()).filter(value=>value.startsWith(ownerSessionCookie+'='));
  if (pairs.length!==1) return null;
  try {
    const value=decodeURIComponent(pairs[0].slice(ownerSessionCookie.length+1));
    const match=/^([A-Za-z0-9_-]{16,128})\.([A-Za-z0-9+/]{43}=)$/.exec(value);
    if (!match) return null;
    const expected=createHmac('sha256',secret).update(match[1]).digest();
    const actual=Buffer.from(match[2],'base64');
    return actual.length===expected.length && timingSafeEqual(actual,expected) ? match[1] : null;
  } catch {
    return null;
  }
}

export type KeyIssuerConfig = Readonly<{
  businessScopes?:'organization-v1'|'requirements-v1';
  socketPath:string; baseURL:string; databaseURL:string; databaseName:string;
  ownerId:string; ownerEmail:string; spaceId:string; sessionSecret:string; agentSecret:string;
}>;

export function readKeyIssuerConfig(raw: unknown): KeyIssuerConfig {
  const keys=['socketPath','baseURL','databaseURL','ownerId','ownerEmail','spaceId','sessionSecret','agentSecret'] as const;
  const values=fields(raw,keys)??fields(raw,[...keys,'businessScopes']);
  if(values&&Object.hasOwn(values,'businessScopes')&&values.businessScopes!=='organization-v1'&&values.businessScopes!=='requirements-v1')throw Error('Invalid issuer configuration');
  if (!values || keys.some(key=>typeof values[key]!=='string')) throw Error('Invalid issuer configuration');
  const config=values as Omit<KeyIssuerConfig,'databaseName'>;
  const origin=new URL(config.baseURL);
  const database=new URL(config.databaseURL);
  if (!isHTTPSOrigin(origin)||origin.origin!==config.baseURL||!/^(?:\/[-A-Za-z0-9_]+)+\/[-A-Za-z0-9_]+\.sock$/.test(config.socketPath)||
      Buffer.byteLength(config.socketPath)>100||
      !['postgres:','postgresql:'].includes(database.protocol)||database.hostname!=='127.0.0.1'||!database.port||Number(database.port)<1024||
      database.username!==role||!database.password||database.search||database.hash||
      !/^\/lifeos_platform_test_[a-z0-9_]+$/.test(database.pathname)||
      !/^[A-Za-z0-9_-]{6,80}$/.test(config.ownerId)||!/^[A-Za-z0-9_-]{8,80}$/.test(config.spaceId)||
      !/^\S+@\S+\.\S+$/.test(config.ownerEmail)||config.ownerEmail!==config.ownerEmail.toLowerCase()||
      [config.sessionSecret,config.agentSecret].some(secret=>Buffer.byteLength(secret)<32||Buffer.byteLength(secret)>512)||
      config.sessionSecret===config.agentSecret) throw Error('Invalid issuer configuration');
  return Object.freeze({...config,databaseName:database.pathname.slice(1)});
}

type GrantRow = {id:string;name:string|null;createdAt:Date;expiresAt:Date|null;enabled:boolean|null;permissions:unknown;cursorTime?:string;grantDigest?:string};
function fromRow(row: GrantRow): KeySummary {
  const permissions=typeof row.permissions==='string'?JSON.parse(row.permissions):row.permissions;
  const scopes=decodeAgentPermissions(permissions);
  if (!scopes) throw Error('Unexpected grant metadata');
  return {id:row.id,name:row.name??'',scopes,...(row.grantDigest?{grantDigest:row.grantDigest}:{}),
    createdAt:new Date(row.createdAt).toISOString(),expiresAt:row.expiresAt?.toISOString()??null,
    status:row.enabled===false?'revoked':row.expiresAt&&row.expiresAt.valueOf()<=Date.now()?'expired':'active'};
}

export async function createPostgresKeyIssuer(config: KeyIssuerConfig) {
  const [{Pool},{betterAuth},{apiKey}]=await Promise.all([import('pg'),import('better-auth'),import('@better-auth/api-key')]);
  const pool=new Pool({connectionString:config.databaseURL,max:2,connectionTimeoutMillis:2000,statement_timeout:4000,
    lock_timeout:2000,idle_in_transaction_session_timeout:4000,options:'-c search_path=lifeos_agent,pg_catalog'});
  try {
    const {rows:[permissions]}=await pool.query(`SELECT current_user AS role,current_database() AS database,
      NOT (r.rolsuper OR r.rolcreatedb OR r.rolcreaterole OR r.rolinherit OR r.rolbypassrls OR r.rolreplication) AS restricted,
      NOT EXISTS (SELECT 1 FROM pg_auth_members WHERE member=r.oid) AS no_memberships,
      NOT has_schema_privilege(current_user,'lifeos_platform','USAGE') AS no_business_schema,
      NOT has_database_privilege(current_user,current_database(),'CREATE') AS no_database_create,
      NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname !~ '^pg_temp_' AND nspname !~ '^pg_toast_temp_' AND has_schema_privilege(current_user,oid,'CREATE')) AS no_schema_create,
      has_function_privilege(current_user,'lifeos_agent.verify_management_session(text,text,text)','EXECUTE') AS can_check_session,
      lifeos_agent.key_management_binding_matches($1,$2) AS matches_binding,
      has_table_privilege(current_user,'lifeos_agent.apikey','INSERT') AS can_issue,
      has_column_privilege(current_user,'lifeos_agent.apikey','enabled','UPDATE') AS can_revoke,
      NOT has_column_privilege(current_user,'lifeos_agent.apikey','permissions','UPDATE') AS cannot_escalate,
      NOT has_column_privilege(current_user,'lifeos_agent.apikey','metadata','UPDATE') AS cannot_rebind,
      NOT has_column_privilege(current_user,'lifeos_agent.apikey','expiresAt','UPDATE') AS cannot_extend,
      NOT has_column_privilege(current_user,'lifeos_agent.apikey','referenceId','UPDATE') AS cannot_change_owner,
      NOT has_column_privilege(current_user,'lifeos_agent.apikey','key','UPDATE') AS cannot_replace_key,
      NOT has_table_privilege(current_user,'lifeos_agent.apikey','TRUNCATE,REFERENCES,TRIGGER') AS no_key_table_admin,
      c.relrowsecurity AND c.relowner<>r.oid AS key_rls
      FROM pg_roles r JOIN pg_class c ON c.oid='lifeos_agent.apikey'::regclass WHERE r.rolname=current_user`,[config.ownerId,config.spaceId]);
    if (!permissions||permissions.role!==role||permissions.database!==config.databaseName||
        Object.entries(permissions).some(([key,value])=>key!=='role'&&key!=='database'&&value!==true)) throw Error('Restricted issuer role required');
    if(config.businessScopes)await verifyAgentBusinessReadiness(pool);
    if(config.businessScopes==='requirements-v1')await verifyAgentRequirementsReadiness(pool);
    const auth=betterAuth({baseURL:config.baseURL,secret:config.agentSecret,database:pool,
      logger:{disabled:true},telemetry:{enabled:false},plugins:[apiKey({enableSessionForAPIKeys:false,enableMetadata:true,
        keyExpiration:{minExpiresIn:0,maxExpiresIn:365},maximumNameLength:80,startingCharactersConfig:{shouldStore:false}})]});
    await auth.$context;
    const bind=[config.ownerId,config.spaceId];
    const handle=createKeyIssuer({
      authenticate:async header=>{
        if(config.businessScopes)await verifyAgentBusinessReadiness(pool);
        if(config.businessScopes==='requirements-v1')await verifyAgentRequirementsReadiness(pool);
        const token=readSignedOwnerSession(header,config.sessionSecret);
        if (!token) return false;
        const {rows:[row]}=await pool.query('SELECT lifeos_agent.verify_management_session($1,$2,$3) AS allowed',[token,config.ownerId,config.ownerEmail]);
        return row?.allowed===true;
      },
      list:async cursor=>{
        const [,time,id]=cursor ? cursorPattern.exec(cursor)! : [];
        const {rows}=await pool.query<GrantRow>(`SELECT id,name,"createdAt","expiresAt",enabled,permissions,
          ${config.businessScopes?'lifeos_agent.managed_grant_digest(id) AS "grantDigest",':''}
          to_char("createdAt" AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "cursorTime"
          FROM lifeos_agent.apikey WHERE "referenceId"=$1 AND metadata::jsonb->>'spaceId'=$2
          AND ($3::timestamptz IS NULL OR ("createdAt",id)<($3::timestamptz,$4::text))
          ORDER BY "createdAt" DESC,id DESC LIMIT 101`,[...bind,time??null,id??null]);
        const keys=rows.slice(0,100);
        const last=keys.at(-1);
        return {keys:keys.map(fromRow),...(rows.length>100&&last ? {nextCursor:last.cursorTime+'~'+last.id} : {})};
      },
      issue:async input=>{
        const key=await auth.api.createApiKey({body:{userId:config.ownerId,name:input.name,expiresIn:input.expiresIn,
          metadata:{spaceId:config.spaceId},permissions:Object.fromEntries(Object.entries(encodeAgentPermissions(input.scopes)).map(([domain,actions])=>[domain,[...actions]])),
          rateLimitEnabled:true,rateLimitTimeWindow:60000,rateLimitMax:20}});
        if (!key.expiresAt || typeof key.key!=='string') throw Error('Unconfirmed issuer result');
        const digest=config.businessScopes?(await pool.query('SELECT lifeos_agent.managed_grant_digest($1) AS digest',[key.id])).rows[0]?.digest:undefined;
        return {grant:fromRow({...key,expiresAt:key.expiresAt,grantDigest:digest}),key:key.key};
      },
      setScopes:async(input,cookie)=>{
        const token=readSignedOwnerSession(cookie,config.sessionSecret);
        if(!token)throw new PlatformError(401,'AUTH_REQUIRED','Owner session required');
        const client=await pool.connect();
        try {
          await client.query('BEGIN');
          await client.query('SELECT lifeos_agent.set_managed_grant_scopes($1,$2,$3,$4::jsonb)',[token,input.id,input.expectedGrantDigest,JSON.stringify(encodeAgentPermissions(input.scopes))]);
          const {rows}=await client.query<GrantRow>(`SELECT id,name,"createdAt","expiresAt",enabled,permissions,lifeos_agent.managed_grant_digest(id) AS "grantDigest" FROM lifeos_agent.apikey WHERE id=$1`,[input.id]);
          if(rows.length!==1)throw Error('Unconfirmed grant');
          const result=fromRow(rows[0]);await client.query('COMMIT');return result;
        }catch(error){
          await client.query('ROLLBACK').catch(()=>undefined);
          const code=(error as {code?:string}).code;
          if(code==='LG401')throw new PlatformError(401,'AUTH_REQUIRED','Owner MFA required');
          if(code==='LG403')throw new PlatformError(403,'ACCESS_DENIED','Grant unavailable');
          if(code==='LG409')throw new PlatformError(409,'KEY_CONFLICT','Grant changed');
          if(code==='LG400')throw new PlatformError(400,'INVALID_REQUEST','Invalid scopes');
          throw error;
        }finally{client.release();}
      },
      revoke:async id=>{
        const {rowCount}=await pool.query(`UPDATE lifeos_agent.apikey SET enabled=false,"updatedAt"=clock_timestamp()
          WHERE "referenceId"=$1 AND metadata::jsonb->>'spaceId'=$2 AND id=$3`,[...bind,id]);
        return rowCount===1;
      },
    },Date.now,config.businessScopes);
    return {handle,close:()=>pool.end()};
  } catch (error) {
    await pool.end();
    throw error;
  }
}
