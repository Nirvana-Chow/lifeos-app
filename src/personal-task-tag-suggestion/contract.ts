export const taskTagSuggestionPath = '/api/platform/personal/todo/tag-suggestions';
export const taskTagSuggestionScope = 'current-todo-and-explicit-topic-names-v1';
export const taskTagTextLimit = 2000;
export const taskTagCandidateLimit = 12;
export const taskTagResultLimit = 5;

export type TaskTagCandidate = {id:string; revision:number; title:string};
export type TaskTagSuggestionInput = {
  scope:typeof taskTagSuggestionScope;
  todoText:string;
  candidates:TaskTagCandidate[];
};
export type TaskTagSuggestionResponse = {topicIds:string[]};

const topicId = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const safeTitle = (title:unknown):title is string => typeof title==='string' &&
  title.length<=240 && title.trim().length>0 && !/[\u0000-\u001f\u007f]/.test(title);
const object = (value:unknown):value is Record<string,unknown> => !!value && typeof value==='object' && !Array.isArray(value);

export function isTaskTagCandidate(value:unknown):value is TaskTagCandidate {
  return object(value) && Object.keys(value).length===3 && typeof value.id==='string' && topicId.test(value.id) &&
    typeof value.revision==='number' && Number.isInteger(value.revision) && value.revision>=1 && value.revision<=2147483647 &&
    safeTitle(value.title);
}

export function parseTaskTagSuggestionInput(value:unknown):TaskTagSuggestionInput|null {
  if(!object(value) || Object.keys(value).length!==3 || value.scope!==taskTagSuggestionScope ||
    typeof value.todoText!=='string' || value.todoText.includes('\0') || !value.todoText.trim() || value.todoText.length>taskTagTextLimit ||
    !Array.isArray(value.candidates) || value.candidates.length<1 || value.candidates.length>taskTagCandidateLimit ||
    !value.candidates.every(isTaskTagCandidate) || new Set(value.candidates.map(candidate=>candidate.id)).size!==value.candidates.length) return null;
  return {scope:taskTagSuggestionScope,todoText:value.todoText,candidates:value.candidates};
}

export function parseTaskTagSuggestionResponse(value:unknown,candidates:readonly TaskTagCandidate[]):TaskTagSuggestionResponse|null {
  if(!object(value) || Object.keys(value).length!==1 || !Array.isArray(value.topicIds) || value.topicIds.length>taskTagResultLimit ||
    new Set(value.topicIds).size!==value.topicIds.length || !value.topicIds.every(id=>candidates.some(candidate=>candidate.id===id))) return null;
  return {topicIds:value.topicIds};
}
