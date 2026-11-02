export type WorkspaceStatus={state:'checking'|'not-signed-in'|'review-only'|'personal'|'unavailable';personalAccountReady:boolean;personalDataAuthorized:boolean;storageConnected:boolean;calendarConnected:boolean;schemaVersion:number|null};
export const initialWorkspaceStatus:WorkspaceStatus={state:'checking',personalAccountReady:false,personalDataAuthorized:false,storageConnected:false,calendarConnected:false,schemaVersion:null};

export function createWorkspaceStatusReader(load:()=>Promise<Response>,publish:(value:WorkspaceStatus)=>void){
 let sequence=0,disposed=false;
 return{
  async refresh(){
   if(disposed)return;const current=++sequence;
   const accept=(value:WorkspaceStatus)=>{if(!disposed&&current===sequence)publish(value);};
   accept({...initialWorkspaceStatus});
   try{
    const response=await load();
    if(response.status===401){accept({...initialWorkspaceStatus,state:'not-signed-in'});return;}
    if(!response.ok)throw Error('Status unavailable');
    const value=await response.json();
    if(value.scope==='personal-manual-candidate'&&value.personalAccountReady===true&&value.personalDataAuthorized===true&&value.storageVerified===true){accept({...initialWorkspaceStatus,state:'personal',personalAccountReady:true,personalDataAuthorized:true,storageConnected:true});return;}
    if(value.scope!=='isolated-synthetic-review'||value.personalAccountReady!==false||value.personalDataAuthorized!==false)throw Error('Unexpected workspace scope');
    accept({...initialWorkspaceStatus,state:'review-only',storageConnected:value.storage?.restrictedRoleVerified===true,calendarConnected:value.storage?.restrictedRoleVerified===true&&value.extensions?.calendar?.configured===true&&value.extensions.calendar.restrictedRoleVerified===true,schemaVersion:Number.isSafeInteger(value.storage?.schemaVersion)?value.storage.schemaVersion:null});
   }catch{accept({...initialWorkspaceStatus,state:'unavailable'});}
  },
  dispose(){disposed=true;sequence++;},
 };
}
