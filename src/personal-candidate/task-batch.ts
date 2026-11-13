import {makePersonalCommand,type PersonalCommand,type PersonalBinding} from './client.ts';
import {validateTodo} from '../platform/domain.ts';
import type {PublicEntry} from '../platform/contracts.ts';
type Store=Pick<Storage,'getItem'|'setItem'|'removeItem'>;
export type BatchRow={title:string;selected:boolean;state:'pending'|'unknown'|'failed'|'verified';command:PersonalCommand|null;receipt:Pick<PublicEntry,'id'|'revision'>|null};
export function batchIssues(rows:readonly BatchRow[]):(string|null)[]{const seen=new Set<string>();return rows.map(row=>{if(!row.selected||row.state==='verified')return null;const title=row.title.trim();const issue=!title?'空白行：请填写或取消勾选':row.title.length>240?'标题超过240字符':seen.has(title)?'重复行：请编辑或取消勾选':null;seen.add(title);return issue;});}
/** Browser-only, owner-scoped recovery. Commands are retained before the existing writer is called. */
export class TaskBatch {
 rows:BatchRow[]=[];raw='';private busy=false;private storageKey:string;
 private binding:PersonalBinding;private storage:Store;private key:()=>string;
 constructor(binding:PersonalBinding,storage:Store,key:()=>string){this.binding=binding;this.storage=storage;this.key=key;this.storageKey='lifeos.personal.todo-batch.v1:'+encodeURIComponent(binding.ownerId)+':'+encodeURIComponent(binding.spaceId);const saved=storage.getItem(this.storageKey);if(saved){const parsed=JSON.parse(saved);if(!Array.isArray(parsed.rows)||parsed.rows.length>50||typeof parsed.raw!=='string')throw Error('批次草稿无法核对，请保留当前页面。');this.raw=parsed.raw;this.rows=parsed.rows;for(const row of this.rows){if(typeof row.title!=='string'||typeof row.selected!=='boolean'||!['pending','unknown','failed','verified'].includes(row.state))throw Error('批次草稿无效。');if(row.command){const expected=this.command(row.title,row.command.key);if(JSON.stringify(expected)!==JSON.stringify(row.command))throw Error('保留的行请求无法核对。');}if(row.state==='unknown'&&!row.command)throw Error('保留的行请求缺失。');}}
 }
 private command(title:string,key:string){return makePersonalCommand(this.binding,'todo',null,validateTodo({title,notes:'',dueOn:null,status:'open'}),key,true);}
 private keep(){const value=JSON.stringify({raw:this.raw,rows:this.rows});this.storage.setItem(this.storageKey,value);if(this.storage.getItem(this.storageKey)!==value)throw Error('无法保留批次，尚未继续发送。');}
 draft(raw:string){if(this.busy||this.rows.length)return;this.raw=raw;this.keep();}
 preview(raw:string){if(this.rows.some(r=>r.command)||this.busy)throw Error('请先完成原批次。');const lines=raw.split(/\r\n|\n|\r/);if(lines.length>50)throw Error('每批最多50行，请分批录入。');this.raw=raw;this.rows=lines.map(title=>({title,selected:true,state:'pending',command:null,receipt:null}));this.keep();}
 edit(index:number,title:string,selected:boolean){const row=this.rows[index];if(!row||row.command||this.busy)return;row.title=title;row.selected=selected;this.keep();}
 clear(){if(this.busy||this.rows.some(r=>r.state==='unknown'))throw Error('请先核对原请求。');this.storage.removeItem(this.storageKey);this.rows=[];this.raw='';}
 async run(save:(command:PersonalCommand)=>Promise<PublicEntry|null>,changed:()=>void=()=>{},uncertain:()=>boolean=()=>true){if(this.busy||batchIssues(this.rows).some(Boolean)||!this.rows.some(r=>r.selected&&r.state!=='verified'))return;this.busy=true;try{for(const row of this.rows){if(!row.selected||row.state==='verified')continue;row.command??=this.command(row.title,this.key());row.state='unknown';this.keep();changed();let receipt:PublicEntry|null=null;try{receipt=await save(row.command);}catch{/* Unknown outcome retains the exact command. */}if(!receipt){if(!uncertain()){row.state='failed';this.keep();changed();}break;}row.receipt={id:receipt.id,revision:receipt.revision};row.state='verified';this.keep();changed();}}finally{this.busy=false;changed();}}
}
