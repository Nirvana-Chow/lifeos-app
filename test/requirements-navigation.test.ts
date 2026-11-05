import test from 'node:test';
import assert from 'node:assert/strict';
import {requirementDepartureAllowed} from '../src/requirements-candidate/navigation.ts';
test('actual requirement departure keeps dirty drafts unless discarded and blocks unknown writes without offering discard',()=>{
 let confirms=0,explains=0;const confirm=()=>{confirms++;return false;},explain=()=>{explains++;};
 assert.equal(requirementDepartureAllowed({dirty:false,phase:'idle'},confirm,explain),true);assert.equal(confirms,0);
 assert.equal(requirementDepartureAllowed({dirty:true,phase:'idle'},confirm,explain),false);assert.equal(confirms,1);
 assert.equal(requirementDepartureAllowed({dirty:true,phase:'idle'},()=>true,explain),true);
 for(const phase of ['saving','uncertain'])assert.equal(requirementDepartureAllowed({dirty:false,phase},confirm,explain),false);
 assert.equal(confirms,1);assert.equal(explains,2);
});
