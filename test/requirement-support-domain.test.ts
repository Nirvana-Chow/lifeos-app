import test from 'node:test';
import assert from 'node:assert/strict';
import {validateRequirementSupportMetadata,validateFeedbackInput} from '../src/requirement-support-candidate/domain.ts';

test('feedback intake retains exact original long text and accepts no approval or owner claims',()=>{
 const text='  原始反馈\n第二行  ';
 assert.equal(validateFeedbackInput({text}).text,text);
 assert.equal(validateFeedbackInput({text:'长'.repeat(16384)}).text.length,16384);
 for(const extra of [{text:'x'.repeat(16385)},{text:''},{text:'x',accepted:true},{text:'x',ownerId:'forged'}])assert.throws(()=>validateFeedbackInput(extra));
});
test('typed support metadata keeps feedback and version-read preference distinct',()=>{
 assert.deepEqual(validateRequirementSupportMetadata({schema:1,type:'feedback',state:'inbox',references:[]}),{schema:1,type:'feedback',state:'inbox',references:[]});
 assert.deepEqual(validateRequirementSupportMetadata({schema:1,type:'release-read',sourceSha:'a'.repeat(40)}),{schema:1,type:'release-read',sourceSha:'a'.repeat(40)});
 for(const metadata of [{schema:1,type:'feedback',state:'accepted',references:[]},{schema:1,type:'feedback',state:'converted',references:[]},{schema:1,type:'release-read',sourceSha:'not-a-source'},{schema:1,type:'release-read',sourceSha:'a'.repeat(40),accepted:true}])assert.throws(()=>validateRequirementSupportMetadata(metadata));
});
