import {agentOperations} from '../agent-api/capabilities.ts';
import {organizationTypes} from '../agent-api/organization.ts';
import {validateId} from '../platform/domain.ts';
import {requirementId} from '../requirements-candidate/domain.ts';
import type {Operation} from '../mcp-candidate/schemas.ts';

// A shared scope or policyClass never adds operations to this HTTP surface.
// New registry IDs require explicit business-MCP review before entering this set.
const businessOperationIds:ReadonlySet<string>=new Set([
 'stageFileHandoff','getFileHandoff',
 'listTodos','snapshotTodos','getTodo','createTodo','updateTodo',
 'snapshotOrganization','getOrganization','createOrganization','updateOrganization',
 'snapshotRequirements','getRequirement','createRequirement','updateRequirement',
 'snapshotStorageReviews','getStorageReview','createStorageReview','updateStorageReviewChecklist','updateStorageReviewDecision',
 'snapshotFeedback','getFeedback','createFeedback',
 'snapshotJournal','getJournal','createJournal','updateJournal',
 'snapshotCalendar','getCalendar','createCalendar','updateCalendar',
 'snapshotHealth','getHealth','createHealth','updateHealth',
 'snapshotPerson','getPerson','createPerson','updatePerson',
 'snapshotFinance','getFinance','createFinance','updateFinance',
 'snapshotMedia','getMedia','createMedia','updateMedia',
 'snapshotCareer','getCareer','createCareer','updateCareer',
 'snapshotPortfolio','getPortfolio','createPortfolio','updatePortfolio',
 'snapshotCooking','getCooking','createCooking','updateCooking',
 'previewTodoClassification',
]);

export function isBusinessMcpOperation(operationId:string):boolean{return businessOperationIds.has(operationId);}

function matchesPath(operation:Operation,path:string):boolean{
 const expected=operation.path.split('/'),actual=path.split('/');
 if(expected.length!==actual.length)return false;
 return expected.every((part,index)=>{
  const value=actual[index];
  if(part==='{type}')return organizationTypes.some(type=>type===value);
  if(part==='{id}'){
   try{return (operation.module==='requirements'?requirementId(value):validateId(value))===value;}catch{return false;}
  }
  return part===value;
 });
}

/** Relative Agent routes only; discovery is an internal read, never a tool operation. */
export function isBusinessMcpApiRoute(method:string,path:string):boolean{
 if(path==='/v2/capabilities')return method==='GET';
 return agentOperations.some(operation=>isBusinessMcpOperation(operation.id)&&operation.method===method&&matchesPath(operation,path));
}
