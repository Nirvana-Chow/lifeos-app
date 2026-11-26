'use client';

import {useEffect,useRef,useState} from 'react';
import {Button} from '../ui-review/ui/button';
import {isTaskTagCandidate,parseTaskTagSuggestionInput,parseTaskTagSuggestionResponse,taskTagCandidateLimit,
  taskTagResultLimit,taskTagSuggestionPath,taskTagSuggestionScope,taskTagTextLimit,type TaskTagCandidate} from './contract';

type Props = {
  ownerScope:string|null;
  todoText:string;
  topics:readonly TaskTagCandidate[];
  onUse:(topicIds:readonly string[])=>void;
};

/** Apply accepted IDs to local editor state. The host retains its regular Save action. */
export function TaskTagSuggestionPanel({ownerScope,todoText,topics,onUse}:Props) {
  const [availableFor,setAvailableFor]=useState<string|null>(null);
  const [picked,setPicked]=useState<string[]>([]);
  const [result,setResult]=useState<{key:string; topicIds:string[]}|null>(null);
  const [choice,setChoice]=useState<string[]>([]);
  const [status,setStatus]=useState('');
  const [busy,setBusy]=useState(false);
  const requestRef=useRef<AbortController|null>(null);
  const eligible=topics.filter(isTaskTagCandidate);
  const candidates=picked.flatMap(id=>eligible.find(topic=>topic.id===id)??[]);
  const input=parseTaskTagSuggestionInput({scope:taskTagSuggestionScope,todoText,candidates});
  const key=JSON.stringify([ownerScope,todoText,candidates]);
  const currentResult=result?.key===key?result:null;

  useEffect(()=>{
    setPicked([]);
    setResult(null);
    setAvailableFor(null);
    if(!ownerScope)return;
    const request=new AbortController();
    void fetch(taskTagSuggestionPath,{credentials:'same-origin',cache:'no-store',signal:request.signal})
      .then(async response=>response.ok?await response.json():null)
      .then(value=>{
        if(!request.signal.aborted&&value?.available===true&&value.scope===taskTagSuggestionScope)setAvailableFor(ownerScope);
      })
      .catch(()=>{});
    return ()=>request.abort();
  },[ownerScope]);

  useEffect(()=>{
    setStatus('');
    setBusy(false);
    setResult(null);
    return ()=>requestRef.current?.abort();
  },[key]);

  async function suggest() {
    if(!input||!ownerScope||availableFor!==ownerScope||requestRef.current&&!requestRef.current.signal.aborted)return;
    const request=new AbortController();
    requestRef.current=request;
    setBusy(true);
    setResult(null);
    setStatus('正在请求建议…');
    try{
      const response=await fetch(taskTagSuggestionPath,{method:'POST',credentials:'same-origin',cache:'no-store',
        headers:{'Content-Type':'application/json'},body:JSON.stringify(input),signal:request.signal});
      if(!response.ok)throw Error('Suggestion unavailable');
      const value=parseTaskTagSuggestionResponse(await response.json(),input.candidates);
      if(!value)throw Error('Invalid suggestion');
      if(request.signal.aborted)return;
      setResult({key,topicIds:value.topicIds});
      setChoice(value.topicIds);
      setStatus(value.topicIds.length?'已收到建议，请核对标签。':'本次没有匹配的标签。');
    }catch{
      if(!request.signal.aborted)setStatus('未能取得标签建议，可继续手动选标签。');
    }finally{
      if(requestRef.current===request){requestRef.current=null;setBusy(false);}
    }
  }

  function discard() {
    requestRef.current?.abort();
    requestRef.current=null;
    setBusy(false);
    setResult(null);
    setStatus('已取消本次建议。');
  }

  if(!ownerScope||availableFor!==ownerScope)return <p role="status">标签建议尚未启用，可继续手动选标签。</p>;
  return <fieldset>
    <legend>建议标签</legend>
    <p>请求时会把下列待办文字和你选中的标签名称发给模型。</p>
    <label>本次待办文字<textarea readOnly rows={3} value={todoText}/></label>
    {todoText.length>taskTagTextLimit&&<p>待办文字超过 {taskTagTextLimit} 字。请继续手动选标签。</p>}
    <label>本次候选标签<select value="" disabled={busy||candidates.length>=taskTagCandidateLimit} onChange={event=>{
      const id=event.currentTarget.value;
      if(eligible.some(topic=>topic.id===id)&&!picked.includes(id))setPicked([...picked,id]);
    }}>
      <option value="" disabled>选择标签</option>
      {eligible.filter(topic=>!picked.includes(topic.id)).map(topic=><option key={topic.id} value={topic.id}>{topic.title}</option>)}
    </select></label>
    {candidates.length>0&&<ul>{candidates.map(topic=><li key={topic.id}>{topic.title}{' '}
      <Button type="button" variant="ghost" aria-label={`移除候选 ${topic.title}`} disabled={busy} onClick={()=>setPicked(picked.filter(id=>id!==topic.id))}>移除</Button>
    </li>)}</ul>}
    <Button type="button" variant="outline" disabled={!input||busy} onClick={()=>void suggest()}>发送并获取建议</Button>
    {(busy||currentResult)&&<Button type="button" variant="ghost" onClick={discard}>取消建议</Button>}
    <p role="status">{status}</p>
    {!!currentResult?.topicIds.length&&<fieldset>
      <legend>采用到待办草稿</legend>
      {candidates.map(topic=><label key={topic.id}><input type="checkbox" checked={choice.includes(topic.id)}
        disabled={!choice.includes(topic.id)&&choice.length>=taskTagResultLimit} onChange={event=>{
          setChoice(event.currentTarget.checked?[...choice,topic.id]:choice.filter(id=>id!==topic.id));
        }}/>{topic.title}</label>)}
      <Button type="button" disabled={!choice.length} onClick={()=>{
        onUse(choice);
        setResult(null);
        setStatus('已加入草稿。请在待办中确认后保存。');
      }}>采用所选标签</Button>
    </fieldset>}
  </fieldset>;
}
