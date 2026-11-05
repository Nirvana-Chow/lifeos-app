import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyRecordFields,recordModuleEnabled,recordStageFields} from '../src/personal-candidate/record-modules.ts';
import {normalizePersonalFields} from '../src/personal-candidate/business.ts';
for(const type of ['media','career','portfolio'] as const){
 test(type+' stays closed without its own verified flag',()=>{
  assert.equal(recordModuleEnabled(type,{storageVerified:true,allowedTypes:['todo','journal','project','domain','topic']}),false);
  assert.equal(recordModuleEnabled(type,{storageVerified:false,[type+'Enabled']:true}),false);
  assert.equal(recordModuleEnabled(type,{storageVerified:true,[type+'Enabled']:true}),true);
 });
 test(type+' empty editor is a valid complete input',()=>{
  const fields=emptyRecordFields(type,'UTC');
  assert.deepEqual(normalizePersonalFields(type,{...fields,title:'Internal fixture'}),{...fields,title:'Internal fixture'});
 });
}
test('book board status changes preserve notes, dates and personal metadata',()=>{
 const fields={...emptyRecordFields('media','UTC'),title:'Internal book',text:'Preserve original notes',occurredOn:'2026-11-05'};
 const moved=recordStageFields('media',fields,'in_progress');
 assert.equal(moved.text,fields.text);assert.equal(moved.occurredOn,fields.occurredOn);
 assert.equal(moved.personal?.type,'media');assert.equal(moved.personal?.type==='media'&&moved.personal.state,'in_progress');
 assert.equal(fields.personal?.type==='media'&&fields.personal.state,'wish');
 assert.throws(()=>recordStageFields('media',fields,'applied'));
});
test('career board changes only an opportunity and preserves complete input',()=>{
 const fact={...emptyRecordFields('career','UTC'),title:'Internal education'};
 assert.throws(()=>recordStageFields('career',fact,'applied'));
 const job={...emptyRecordFields('career','UTC','opportunity'),title:'Internal opportunity',text:'Original JD'};
 const moved=recordStageFields('career',job,'interview');
 assert.equal(moved.text,'Original JD');assert.equal(moved.personal?.type==='career'&&moved.personal.careerKind==='opportunity'&&moved.personal.applicationState,'interview');
 assert.throws(()=>recordStageFields('career',job,'completed'));
});
