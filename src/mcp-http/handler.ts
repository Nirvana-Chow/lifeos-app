import {createMcpHandler,Server,ProtocolError} from '@modelcontextprotocol/server';
import {ToolSchema} from '@modelcontextprotocol/core';
import {z} from 'zod';
import {assertLocalRequest} from '../platform/request-boundary.ts';
import {type CapabilityCatalog} from '../mcp-candidate/client.ts';
import {argumentSchema} from '../mcp-candidate/schemas.ts';
import {HttpBusinessClient,type BusinessDispatcher,type HttpOperationResult} from './business-client.ts';
import {readBusinessBearer} from '../business-mcp-oauth/boundary.ts';

export const mcpHttpPath='/api/platform/mcp';
const discoverSchema=z.union([z.strictObject({}),z.strictObject({view:z.literal('index')}),z.strictObject({operationId:z.string().min(1).max(100)})]);
const callSchema=z.strictObject({operationId:z.string().min(1).max(100),arguments:z.record(z.string(),z.unknown())});
const privateHeaders={'Cache-Control':'private, no-store',Vary:'Authorization, MCP-Protocol-Version','X-Content-Type-Options':'nosniff','X-Robots-Tag':'noindex, nofollow, noarchive'};
const failure=(status:number,error:string,extra:Record<string,string>={})=>Response.json({error},{status,headers:{...privateHeaders,...extra}});

function serverFor(client:HttpBusinessClient,token:string){
 const server=new Server({name:'lifeos-http-adapter',version:'0.1.0'},{capabilities:{tools:{}}});
 const result=(value:HttpOperationResult)=>{
  if(JSON.stringify(value).includes(token))value={ok:false,status:502,error:'API_RESPONSE_INVALID'};
  return{content:[{type:'text' as const,text:value.outcome==='unknown'?'Outcome unknown. Preserve the original arguments and idempotency key; resend only the identical lifeos_call.':value.ok?'The API result and separate independent readback are in structuredContent.':value.error??'API_ERROR'}],structuredContent:value,isError:!value.ok};
 };
 server.setRequestHandler('tools/list',async()=>{
  try{const catalog=await client.discover();
   const tools=[ToolSchema.parse({name:'lifeos_discover',description:'Discover currently authorized, enabled LifeOS operations and exact argument schemas.',inputSchema:{...z.toJSONSchema(discoverSchema),type:'object'},annotations:{readOnlyHint:true,openWorldHint:false}})];
   if(catalog.operations.length)tools.push(ToolSchema.parse({name:'lifeos_call',description:'Call a current LifeOS business operation through the same API. Writes retain their original idempotency key and return a separate readback. Unknown results require the identical original call; no in-memory recovery tool is offered.',inputSchema:{type:'object',oneOf:catalog.operations.map(operation=>({type:'object',properties:{operationId:{type:'string',const:operation.id},arguments:z.toJSONSchema(argumentSchema(operation))},required:['operationId','arguments'],additionalProperties:false}))},annotations:{readOnlyHint:catalog.operations.every(operation=>operation.method==='GET'||operation.id==='previewTodoClassification'),openWorldHint:false}}));
   return{tools};
  }catch{throw new ProtocolError(-32603,'API_DISCOVERY_UNAVAILABLE');}
 });
 server.setRequestHandler('tools/call',async request=>{
  const input=request.params.arguments??{};
  if(request.params.name==='lifeos_discover'){
   const parsed=discoverSchema.safeParse(input);
   if(!parsed.success)return result({ok:false,status:400,error:'INVALID_ARGUMENTS'});
   try{const catalog=await client.discover();
    const project=(operation:CapabilityCatalog['operations'][number])=>({...operation,inputSchema:z.toJSONSchema(argumentSchema(operation))});
    let structuredContent:Record<string,unknown>;
    if('operationId'in parsed.data){
     const operationId=parsed.data.operationId;
     const operation=catalog.operations.find(operation=>operation.id===operationId);
     if(!operation)return result({ok:false,status:403,error:'OPERATION_UNAVAILABLE'});
     structuredContent={apiVersion:'2',operation:project(operation)};
    }else if('view'in parsed.data){
     structuredContent={apiVersion:'2',view:'index',operations:catalog.operations.map(({id,module,method,description})=>({id,module,method,description}))};
    }else structuredContent={apiVersion:'2',operations:catalog.operations.map(project)};
    return{content:[{type:'text' as const,text:'Current authorized operations and argument schemas are in structuredContent.'}],structuredContent,isError:false};
   }
   catch{return result({ok:false,status:503,error:'API_DISCOVERY_UNAVAILABLE'});}
  }
  if(request.params.name!=='lifeos_call')return result({ok:false,status:403,error:'OPERATION_UNAVAILABLE'});
  const parsed=callSchema.safeParse(input);return parsed.success?result(await client.execute(parsed.data.operationId,parsed.data.arguments)):result({ok:false,status:400,error:'INVALID_ARGUMENTS'});
 });
 server.onerror=()=>{};return server;
}

/** A new closure and official SDK server per request; no session or credential cache. */
export function createMcpHttpHandler(options:{enabled?:boolean;origin:string;dispatch:BusinessDispatcher;oauthResourceMetadata?:string}){
 const configured=new URL(options.origin);
 if(configured.protocol!=='https:'||configured.origin!==options.origin||configured.username||configured.password)throw Error('MCP_HTTP_CONFIG_INVALID');
 return async(request:Request):Promise<Response>=>{
  if(options.enabled!==true)return failure(404,'NOT_FOUND');
  const url=new URL(request.url);
  if(url.pathname!==mcpHttpPath||url.search||url.hash)return failure(404,'NOT_FOUND');
  try{assertLocalRequest(request,options.origin);if(request.headers.has('origin')&&request.headers.get('origin')!==options.origin)throw Error();}
  catch{return failure(403,'ORIGIN_DENIED');}
  if(request.method!=='POST')return failure(405,'METHOD_NOT_ALLOWED',{Allow:'POST'});
  const token=readBusinessBearer(request.headers.get('authorization'));
  const challenge='Bearer realm="LifeOS"'+(options.oauthResourceMetadata?', resource_metadata="'+options.oauthResourceMetadata+'"':'');
  if(!token)return failure(401,'AUTH_REQUIRED',{'WWW-Authenticate':challenge});
  if(request.signal.aborted)return failure(400,'REQUEST_CANCELLED');
  const client=new HttpBusinessClient(options.origin,token,options.dispatch,request.signal);
  try{await client.discover();}catch(error){
   const status=error&&typeof error==='object'&&'status'in error?error.status:0;
   return status===401?failure(401,'AUTH_REQUIRED',{'WWW-Authenticate':challenge}):status===403?failure(403,'ACCESS_DENIED'):failure(503,'MCP_API_UNAVAILABLE');
  }
  const http=createMcpHandler(()=>serverFor(client,token),{legacy:'stateless',responseMode:'auto',maxRequestBodySize:131072,maxSubscriptions:0,keepAliveMs:0,onerror:()=>{}});
  try{
   const response=await http.fetch(request),reader=response.body?.getReader();const chunks:Uint8Array[]=[];let size=0;
   if(reader)try{for(;;){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>8*1024*1024){await reader.cancel();return failure(502,'MCP_RESPONSE_TOO_LARGE');}chunks.push(part.value);}}finally{reader.releaseLock();}
   const bytes=Buffer.concat(chunks);
   if(bytes.toString('utf8').includes(token))return failure(502,'MCP_RESPONSE_INVALID');
   const headers=new Headers(response.headers);for(const[name,value]of Object.entries(privateHeaders))headers.set(name,value);
   return new Response(response.body===null?null:bytes,{status:response.status,headers});
  }catch{return failure(503,'MCP_REQUEST_UNAVAILABLE');}finally{await http.close().catch(()=>{});}
 };
}
