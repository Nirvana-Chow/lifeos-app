'use client';

import {editorFromEntry} from '../personal-candidate/editor';
import type {TaskLabelSuggestionAction} from '../personal-candidate/task-editor';
import {taskTagBindingHeader,taskTagSuggestionPath,taskTagSuggestionScope} from './contract';
import {TaskTagSuggestionPanel} from './panel';

export const TaskLabelSuggestion:TaskLabelSuggestionAction=({binding,todoText,availableLabels,onAdd})=>{
 const ownerScope=JSON.stringify([binding.ownerId,binding.spaceId]);

 async function useLabels(ids:readonly string[],signal:AbortSignal) {
  const wanted=new Set(ids);
  const labels=availableLabels.filter(label=>wanted.has(label.id));
  if(!labels.length||labels.length!==ids.length)return false;
  const get=async(path:string,headers?:HeadersInit)=>{
   const response=await fetch(path,{signal,headers,credentials:'same-origin',cache:'no-store'});
   if(!response.ok)throw Error('Unable to verify current label access');
   return response.json();
  };
  const root='/api/platform/personal/';
  const capabilityHeaders={[taskTagBindingHeader]:ownerScope};
  async function assertScope(){
   const [access,capability]=await Promise.all([get(root+'status'),get(taskTagSuggestionPath,capabilityHeaders)]);
   if(access?.scope!=='personal-manual-candidate'||access.ownerId!==binding.ownerId||access.spaceId!==binding.spaceId||
    access.storageVerified!==true||access.writable!==true||!Array.isArray(access.allowedTypes)||
    !access.allowedTypes.includes('todo')||!access.allowedTypes.includes('topic')||
    capability?.scope!==taskTagSuggestionScope||capability.available!==true)
    throw Error('Label suggestion authorization changed');
  }
  await assertScope();
  const confirmed=await Promise.all(labels.map(async label=>{
   const {entry}=await get(root+'topic/'+encodeURIComponent(label.id));
   const current=editorFromEntry(entry,binding.spaceId);
   if(current.type!=='topic'||entry.id!==label.id||entry.source.id!==label.sourceId||
    entry.revision!==label.revision||current.fields.title!==label.title)
    throw Error('Candidate label changed');
   return {id:label.id,sourceId:label.sourceId,revision:label.revision};
  }));
  await assertScope();
  return !signal.aborted&&onAdd(confirmed);
 }

 return <TaskTagSuggestionPanel ownerScope={ownerScope} todoText={todoText}
  topics={availableLabels.map(({id,revision,title})=>({id,revision,title}))} onUse={useLabels}/>;
};
