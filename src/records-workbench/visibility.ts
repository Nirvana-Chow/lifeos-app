type VisibilityActions={conceal:()=>void;verify:()=>Promise<void>;reveal:()=>void;failed:(cause:unknown)=>void};
/** A hidden or replaced view must never reveal a late successful identity check. */
export function createRecordsVisibilityGuard(actions:VisibilityActions){
 let generation=0,disposed=false;
 return {
  hide(){if(disposed)return;generation++;actions.conceal();},
  async check(){if(disposed)return;const current=++generation;actions.conceal();try{await actions.verify();if(!disposed&&current===generation)actions.reveal();}catch(cause){if(!disposed&&current===generation)actions.failed(cause);}},
  dispose(){disposed=true;generation++;},
 };
}
