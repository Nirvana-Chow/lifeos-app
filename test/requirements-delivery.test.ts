import assert from 'node:assert/strict';
import test from 'node:test';
import {requirements,type Requirement} from '../src/platform/requirements.ts';
import {requirementDelivery} from '../src/ui-review/requirements-delivery.ts';

const baseline = requirements();
const find = (id:string) => structuredClone(baseline.requirements.find(item => item.id===id)!);
const sha = 'a'.repeat(40);
const repo = 'https://github.com/Nirvana-Chow/lifeos-app/';
const merged = {scope:'delivery-merged',ref:repo+'commit/'+sha};
const production = {
 scope:'delivery-production-verified',
 ref:merged.ref,
 resultHref:'https://lifeos.nirvanachow.com/personal/finance',
 verificationHref:repo+'blob/'+sha+'/docs/verification/finance.md',
};

test('delivery evidence matches a fixed merge, verified result and official route', () => {
 const item = find('LO-OUTPUT-001');
 assert.equal(requirementDelivery({...item,evidence:[production]}).state,'not_implemented');
 assert.equal(requirementDelivery({...item,evidence:[merged]}).state,'merged');
 assert.equal(requirementDelivery({...item,evidence:[merged,{...production,resultHref:'https://lifeos.nirvanachow.com.example/personal/finance'}]}).state,'merged');
 assert.equal(requirementDelivery({...item,evidence:[merged,{...production,verificationHref:undefined}]}).state,'merged');
 assert.equal(requirementDelivery({...item,evidence:[merged,{...production,ref:repo+'commit/'+'b'.repeat(40)}]}).state,'merged');
 assert.deepEqual(requirementDelivery({...item,evidence:[merged,production]}),{
  state:'live',result:{label:'打开正式站结果',href:production.resultHref,evidence:production.verificationHref},
 });
});

test('a public default and a private record with no saved progress have different meanings', () => {
 const item = find('LO-OUTPUT-001');
 const privateItem:Requirement = {...item,id:'11111111-1111-4111-8111-111111111111'};
 assert.equal(requirementDelivery(item).state,'not_implemented');
 assert.equal(requirementDelivery(privateItem).state,'unverified');
 assert.equal(requirementDelivery(privateItem,{state:'planned',purpose:'',nextStep:''}).state,'not_implemented');
 assert.equal(requirementDelivery(privateItem,{state:'in_progress',purpose:'',nextStep:''}).state,'in_progress');
 assert.equal(requirementDelivery(privateItem,{state:'done',purpose:'',nextStep:''}).state,'unverified');
});

test('source-only and merged slices never certify whole-requirement publication', () => {
 const people = find('LO-PEOPLE-001');
 assert.deepEqual(requirementDelivery(people),{
  state:'in_progress',result:{label:'人物只读总览（合并记录）',href:repo+'pull/93'},
 });
 assert.equal(requirementDelivery(find('LO-AUTH-001')).state,'unverified');
 assert.equal(requirementDelivery(people,{state:'done',purpose:'',nextStep:''}).state,'unverified');
 assert.deepEqual(find('LO-PEOPLE-001'),people);
});
