/** This guard protects actual departure only. Save, retry, readback and expansion stay reachable. */
export function requirementDepartureAllowed(state:{dirty:boolean;phase:string},confirmDiscard:()=>boolean,explainUnknown:()=>void):boolean{
 if(state.phase==='saving'||state.phase==='uncertain'){explainUnknown();return false;}
 return !state.dirty||confirmDiscard();
}
