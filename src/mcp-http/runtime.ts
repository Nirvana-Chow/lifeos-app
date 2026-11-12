import {readPlatformConfig} from '../platform/config.ts';
import {readAgentMcpHttpTransport} from '../agent-api/config.ts';
import {handleAgentRequest} from '../agent-api/runtime.ts';
import {createMcpHttpHandler} from './handler.ts';

/** Source support never activates an endpoint or substitutes owner-session authority. */
export async function handleMcpHttpRequest(request:Request):Promise<Response>{
 const closed=()=>Response.json({error:'NOT_FOUND'},{status:404,headers:{'Cache-Control':'private, no-store'}});
 try{if(readAgentMcpHttpTransport(process.env)===null)return closed();}catch{return closed();}
 try{
  const platform=readPlatformConfig(process.env);
  if(!platform||process.env.LIFEOS_AGENT_API_ENABLED!=='1')throw Error();
  return await createMcpHttpHandler({enabled:true,origin:platform.baseURL,dispatch:handleAgentRequest})(request);
 }catch{return Response.json({error:'MCP_HTTP_UNAVAILABLE'},{status:503,headers:{'Cache-Control':'private, no-store'}});}
}
