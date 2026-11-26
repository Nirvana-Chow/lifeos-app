import {PlatformError} from '../platform/domain.ts';
import {readJSONBody} from '../platform/request-boundary.ts';
import {
  parseTaskTagSuggestionInput, parseTaskTagSuggestionResponse, taskTagSuggestionPath, taskTagSuggestionScope,
  type TaskTagCandidate,
} from './contract.ts';

export type TaskTagSuggestionProvider = {
  available:(signal:AbortSignal)=>Promise<boolean>;
  suggest:(input:{todoText:string; candidateTitles:readonly string[]}, context:{signal:AbortSignal; assertCurrent:()=>Promise<void>})=>Promise<readonly number[]>;
};

type Options = {
  baseURL:string;
  assertOwner:()=>Promise<void>;
  canReadTopics:boolean;
  getTopic:(id:string)=>Promise<TaskTagCandidate>;
  provider?:TaskTagSuggestionProvider;
};

const headers = {'Cache-Control':'private, no-store','Vary':'Cookie','X-Content-Type-Options':'nosniff'};
const unavailable = () => new PlatformError(503,'TASK_TAG_SUGGESTION_UNAVAILABLE','标签建议尚未启用或暂不可用，可继续手动选标签。');

export async function handleTaskTagSuggestion(request:Request,options:Options):Promise<Response|null> {
  const url=new URL(request.url);
  if(url.pathname!==taskTagSuggestionPath)return null;
  if(request.method!=='GET'&&request.method!=='POST')return Response.json(
    {error:{code:'METHOD_NOT_ALLOWED',message:'此入口仅支持查询或主动请求建议。'}},
    {status:405,headers:{...headers,Allow:'GET, POST'}});
  if(url.search)throw new PlatformError(400,'INVALID_QUERY','此入口不接受查询参数。');
  if(request.headers.has('authorization'))throw new PlatformError(403,'OWNER_ONLY','标签建议仅限当前本人网页会话。');
  const site=request.headers.get('sec-fetch-site');
  if(site==='cross-site'||site==='same-site'||request.method==='POST'&&request.headers.get('origin')!==new URL(options.baseURL).origin)
    throw new PlatformError(403,'ORIGIN_DENIED','请从本人网页主动请求标签建议。');
  await options.assertOwner();
  const {provider}=options;
  const ready=options.canReadTopics&&provider&&await provider.available(request.signal).catch(()=>false);
  if(request.method==='GET'){
    await options.assertOwner();
    return Response.json({available:!!ready,scope:taskTagSuggestionScope},{headers});
  }
  if(!ready||!provider)throw unavailable();
  const input=parseTaskTagSuggestionInput(await readJSONBody(request));
  if(!input)throw new PlatformError(400,'INVALID_TASK_TAG_SUGGESTION','请核对本条待办文字及本次要发送的候选标签。');
  const {candidates,todoText}=input;

  async function assertCurrent() {
    await options.assertOwner();
    const topics=await Promise.all(candidates.map(candidate=>options.getTopic(candidate.id).catch(error=>{
      if(error instanceof PlatformError&&error.status===404)return null;
      throw error;
    })));
    if(topics.some((topic,index)=>!topic||topic.id!==candidates[index].id||
      topic.revision!==candidates[index].revision||topic.title!==candidates[index].title))
      throw new PlatformError(409,'TASK_TAG_CANDIDATE_CHANGED','候选标签已变化，请回到手动选项刷新后再试。');
    await options.assertOwner();
  }

  await assertCurrent();
  const indices=await provider.suggest({todoText,candidateTitles:candidates.map(candidate=>candidate.title)},
    {signal:request.signal,assertCurrent});
  if(!Array.isArray(indices)||!indices.every(index=>Number.isInteger(index)&&index>=1&&index<=candidates.length))throw unavailable();
  const output=parseTaskTagSuggestionResponse({topicIds:indices.map(index=>candidates[index-1].id)},candidates);
  if(!output)throw unavailable();
  await assertCurrent();
  return Response.json(output,{headers});
}
