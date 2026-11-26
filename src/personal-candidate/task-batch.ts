import {makePersonalCommand,type PersonalCommand,type PersonalBinding} from './client.ts';
import {validateTodo,validateId,object} from '../platform/domain.ts';
import type {PublicEntry} from '../platform/contracts.ts';
import {validateTodoOriginalLine} from './todo-capture.ts';
const splitLines=(raw:string)=>raw.split(/\r\n|\n|\r/);
type Store=Pick<Storage,'getItem'|'setItem'|'removeItem'>;
export type BatchRow={title:string;selected:boolean;state:'pending'|'unknown'|'failed'|'verified';command:PersonalCommand|null;receipt:Pick<PublicEntry,'id'|'revision'>|null};
export function batchIssues(rows:readonly BatchRow[]):(string|null)[]{const seen=new Set<string>();return rows.map(row=>{if(!row.selected)return null;const title=row.title.trim();if(row.state==='verified'){seen.add(title);return null;}const issue=!title?'空白行：请填写或取消勾选':row.title.length>240?'标题超过240字符':seen.has(title)?'重复行：请编辑或取消勾选':null;seen.add(title);return issue;});}
/** Browser-only, owner-scoped recovery. Commands are retained before the existing writer is called. */
export class TaskBatch {
 rows:BatchRow[]=[];raw='';private busy=false;private storageKey:string;
 private binding:PersonalBinding;private storage:Store;private key:()=>string;
 constructor(binding:PersonalBinding,storage:Store,key:()=>string){
  this.binding=binding;this.storage=storage;this.key=key;
  this.storageKey='lifeos.personal.todo-batch.v1:'+encodeURIComponent(binding.ownerId)+':'+encodeURIComponent(binding.spaceId);
  const saved=storage.getItem(this.storageKey);
  if(!saved)return;
  const parsed=JSON.parse(saved);
  if(!Array.isArray(parsed.rows)||parsed.rows.length>50||typeof parsed.raw!=='string')throw Error('批次草稿无法核对，请保留当前页面。');
  this.raw=parsed.raw;this.rows=parsed.rows;
  const lines=splitLines(this.raw);
  if(this.rows.length&&this.rows.length!==lines.length)throw Error('批次行数与原始输入不符。');
  for(const [index,row] of this.rows.entries()){
   object(row,['title','selected','state','command','receipt']);
   if(typeof row.title!=='string'||typeof row.selected!=='boolean'||!['pending','unknown','failed','verified'].includes(row.state))throw Error('批次草稿无效。');
   if(row.command){
    // Old in-flight commands retain the original body even if the draft still has the input.
    const line=Object.hasOwn(row.command.body,'originalLine')?lines[index]:undefined;
    const expected=this.command(row.title,row.command.key,line);
    if(JSON.stringify(expected)!==JSON.stringify(row.command))throw Error('保留的行请求无法核对。');
   }
   if(row.state==='pending'){
    if(row.command!==null||row.receipt!==null)throw Error('待处理行包含已尝试请求或回执。');
   }else{
    if(!row.selected||!row.command)throw Error('保留的行请求缺失或未选中。');
    if(row.state==='verified'){
     const receipt=object(row.receipt,['id','revision']);validateId(receipt.id);
     if(receipt.revision!==1)throw Error('新建待办回执版本无效。');
    }else if(row.receipt!==null)throw Error('未核对行包含保存回执。');
   }
  }
 }
 private command(title:string,key:string,originalLine?:string){
  return makePersonalCommand(this.binding,'todo',null,validateTodo({title,notes:'',dueOn:null,status:'open'}),key,true,undefined,originalLine);
 }
 private keep(){const value=JSON.stringify({raw:this.raw,rows:this.rows});this.storage.setItem(this.storageKey,value);if(this.storage.getItem(this.storageKey)!==value)throw Error('无法保留批次，尚未继续发送。');}
 draft(raw:string){if(this.busy||this.rows.length)return;this.raw=raw;this.keep();}
 preview(raw:string){if(this.rows.some(r=>r.command)||this.busy)throw Error('请先完成原批次。');const lines=splitLines(raw);if(lines.length>50)throw Error('每批最多50行，请分批录入。');this.raw=raw;this.rows=lines.map(title=>({title,selected:true,state:'pending',command:null,receipt:null}));this.keep();}
 edit(index:number,title:string,selected:boolean){const row=this.rows[index];if(!row||row.command||this.busy)return;row.title=title;row.selected=selected;this.keep();}
 clear(){if(this.busy||this.rows.some(r=>r.state==='unknown'))throw Error('请先核对原请求。');this.storage.removeItem(this.storageKey);this.rows=[];this.raw='';}
 async run(save:(command:PersonalCommand)=>Promise<PublicEntry|null>,changed:()=>void=()=>{},uncertain:()=>boolean=()=>true){
  if(this.busy||batchIssues(this.rows).some(Boolean)||!this.rows.some(r=>r.selected&&r.state!=='verified'))return;
  const lines=splitLines(this.raw);
  for(const [index,row] of this.rows.entries()){
   if(row.selected&&!row.command)validateTodoOriginalLine(lines[index]);
  }
  this.busy=true;
  try{
   for(const [index,row] of this.rows.entries()){
    if(!row.selected||row.state==='verified')continue;
    row.command??=this.command(row.title,this.key(),lines[index]);
    row.state='unknown';this.keep();changed();
    let receipt:PublicEntry|null=null;
    try{receipt=await save(row.command);}catch{/* Unknown outcome retains the exact command. */}
    if(!receipt){
     if(!uncertain()){row.state='failed';this.keep();changed();}
     break;
    }
    row.receipt={id:receipt.id,revision:receipt.revision};row.state='verified';this.keep();changed();
   }
  }finally{this.busy=false;changed();}
 }
}
