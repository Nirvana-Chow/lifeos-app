import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
const url = new URL('../src/personal-career/domain.ts',import.meta.url);
const domain = existsSync(url) ? await import(url.href) : null;
const pin={id:'11111111-1111-4111-8111-111111111111',sourceId:'22222222-2222-4222-8222-222222222222',revision:1};
function api(){assert.ok(domain,'career domain is not implemented');return domain;}
function fields(kind='education'){return {title:'内部合成记录',text:'原文保留；不推断个人资历',occurredOn:null,personal:api().emptyCareerPersonal(kind)};}
test('career variants preserve unknown facts and keep long source material in the outer text',()=>{
 for(const kind of ['education','employment','achievement','resume','opportunity']){
  const value=fields(kind);const result=api().normalizeCareerPersonalFields(value);
  assert.equal(result.personal.careerKind,kind);assert.equal(result.occurredOn,null);assert.equal(result.text,value.text);
 }
 const education=api().normalizeCareerPersonalFields(fields()).personal;
 assert.deepEqual(education.period,{startOn:null,endOn:null,status:'unknown'});assert.equal(education.organization,null);assert.equal(education.qualification,null);
 const opportunity=api().normalizeCareerPersonalFields(fields('opportunity')).personal;
 assert.equal(opportunity.applicationState,'saved');assert.equal(opportunity.nextStepOn,null);
});
test('career validation rejects invalid dates, invented date order and implicit ongoing ranges',()=>{
 const base=fields();
 for(const period of [
  {startOn:'2026-02-30',endOn:null,status:'unknown'},
  {startOn:'2026-13',endOn:null,status:'unknown'},
  {startOn:'2026-03',endOn:'2025',status:'ended'},
  {startOn:null,endOn:'2026-01-01',status:'current'},
 ])assert.throws(()=>api().normalizeCareerPersonalFields({...base,personal:{...base.personal,period}}));
 const partial=api().normalizeCareerPersonalFields({...base,personal:{...base.personal,period:{startOn:'2020',endOn:null,status:'current'}}});
 assert.equal(partial.personal.period.startOn,'2020');assert.equal(partial.personal.period.endOn,null);
 assert.throws(()=>api().normalizeCareerPersonalFields({...base,occurredOn:'2026-11'}));
});
test('career complete writes deny omitted, foreign, unsafe source and variant fields',()=>{
 const base=fields();
 for(const key of Object.keys(base)){const v:Record<string,unknown>={...base};delete v[key];assert.throws(()=>api().normalizeCareerPersonalFields(v));}
 for(const key of Object.keys(base.personal)){const v={...base.personal};delete v[key];assert.throws(()=>api().validateCareerPersonal(v));}
 for(const patch of [{schemaVersion:2},{ownerId:'someone'},{applicationState:'applied'},{source:{kind:'manual',label:null,url:'javascript:alert(1)'}},{source:{kind:'imported',label:null,url:null}},{highlights:[null]}]) assert.throws(()=>api().validateCareerPersonal({...base.personal,...patch}));
 assert.throws(()=>api().validateCareerPersonal({...fields('opportunity').personal,applicationState:'hired'}));
 assert.throws(()=>api().validateCareerPersonal({...base.personal,source:{kind:'manual',label:null,url:'https://user:secret@example.test/jd'}}));
});
test('career references expose typed locked pins for facts, evidence and organization relations',()=>{
 const value=fields('opportunity');value.personal.links={project:pin,domain:null,topics:[]};value.personal.requirements=[{requirement:'有可核实的交付证据',facts:[pin],gap:null,nextAction:null}];
 assert.deepEqual(api().careerPersonalReferences(api().validateCareerPersonal(value.personal)),[{type:'project',link:pin},{type:'career',link:pin,expectedKinds:['education','employment','achievement']}]);
 const education=fields();education.personal.evidence=[{label:'原始项目',url:null,reference:{type:'project',link:pin}}];
 assert.deepEqual(api().careerPersonalReferences(api().validateCareerPersonal(education.personal)),[{type:'project',link:pin}]);
 for(const facts of [[pin,pin],[{...pin,revision:0}],[{...pin,sourceId:'bad'}]])assert.throws(()=>api().validateCareerPersonal({...fields('resume').personal,facts}));
 assert.throws(()=>api().validateCareerPersonal({...education.personal,evidence:[{label:'无来源',url:null,reference:null}]}));
});
