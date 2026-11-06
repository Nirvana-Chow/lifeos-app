'use client';
import {useEffect,useMemo,useRef,useState} from 'react';
import {useTable,type ColumnDef} from '@tanstack/react-table';
import {DataGrid,DataGridContainer,dataGridFeatures} from '../ui-review/reui/data-grid';
import {DataGridTableVirtual} from '../ui-review/reui/data-grid-table-virtual';
import {Button} from '../ui-review/ui/button';
import {Dialog,DialogContent,DialogTitle,DialogDescription} from '../ui-review/ui/dialog';
import type {FinanceDraft} from '../platform/domain';
import type {FinanceBinding,FinanceSnapshot,PersonalFinanceEntry,PersonalFinanceStatus} from './contracts';
import {financeAmountMinor,financeKindLabels,formatFinanceAmount,summarizeFinance} from './domain';
import {clearPersonalFinanceCommand,freezePersonalFinanceCommand,isRejectedPersonalFinanceCommand,keepPersonalFinanceCommand,PersonalFinanceClientError,readPersonalFinanceCommand,readPersonalFinanceHistory,readPersonalFinanceRecord,readPersonalFinanceSnapshot,readPersonalFinanceStatus,sendPersonalFinanceCommand,type PersonalFinanceCommand} from './client';
import s from './workbench.module.css';

type Editor={scope:string;record:PersonalFinanceEntry|null;fields:FinanceDraft;amount:string;initial:string;history:Awaited<ReturnType<typeof readPersonalFinanceHistory>>|null};
const message=(cause:unknown)=>cause instanceof Error?cause.message:'操作未完成，请保留输入。';
const scopeOf=(owner:FinanceBinding)=>JSON.stringify([owner.ownerId,owner.spaceId]);
function today(){const value=new Date();return`${value.getFullYear()}-${String(value.getMonth()+1).padStart(2,'0')}-${String(value.getDate()).padStart(2,'0')}`;}
const fresh=():FinanceDraft=>({kind:'expense',amountMinor:1,currency:'CNY',occurredOn:today(),category:null,fromAccountRef:null,toAccountRef:null,originalEntryId:null,notes:''});
const fingerprint=(fields:FinanceDraft,amount:string)=>JSON.stringify({fields,amount});
const isRejected=(command:PersonalFinanceCommand)=>{try{return isRejectedPersonalFinanceCommand(sessionStorage,command);}catch{return false;}};

export function PersonalFinanceWorkbench({navigationGuard}:{navigationGuard?:{current:(()=>boolean)|null}}){
 const [status,setStatus]=useState<PersonalFinanceStatus|null>(null),[snapshot,setSnapshot]=useState<{scope:string;value:FinanceSnapshot}|null>(null),[verified,setVerified]=useState(false);
 const [editor,setEditor]=useState<Editor|null>(null),[pending,setPending]=useState<PersonalFinanceCommand|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[rejectedKey,setRejectedKey]=useState<string|null>(null);
 const [search,setSearch]=useState(''),[kind,setKind]=useState('all'),[view,setView]=useState<'transactions'|'accounts'>('transactions'),[rowEstimate,setRowEstimate]=useState(52);
 const generation=useRef(0),saving=useRef(false),bindingRef=useRef<string|null>(null),editorRef=useRef(editor),pendingRef=useRef(pending);editorRef.current=editor;pendingRef.current=pending;
 const owner=status?.configured?{ownerId:status.ownerId,spaceId:status.spaceId}:null,scope=owner?scopeOf(owner):null;
 const shown=verified&&snapshot?.scope===scope?snapshot.value:null,shownEditor=verified&&editor?.scope===scope?editor:null,shownPending=verified&&pending&&scopeOf(pending.binding)===scope?pending:null;
 const shownRejected=!!shownPending&&rejectedKey===shownPending.key;
 const writable=!!shown&&status?.configured===true&&status.writable,dirty=!!shownEditor&&fingerprint(shownEditor.fields,shownEditor.amount)!==shownEditor.initial,locked=busy||!!shownPending;
 function canLeave(){const current=editorRef.current;if(saving.current||pendingRef.current)return false;return!current||fingerprint(current.fields,current.amount)===current.initial||window.confirm('这条流水尚未保存，放弃本次输入？');}
 async function refresh(){
  const token=++generation.current;setVerified(false);setError('');
  try{
   const next=await readPersonalFinanceStatus(fetch);if(token!==generation.current)return;
   if(!next.configured){setStatus(next);setSnapshot(null);setEditor(null);setPending(null);setRejectedKey(null);bindingRef.current=null;setVerified(true);return;}
   const nextOwner={ownerId:next.ownerId,spaceId:next.spaceId},nextScope=scopeOf(nextOwner);
   if(bindingRef.current&&bindingRef.current!==nextScope){setEditor(null);setPending(null);setRejectedKey(null);setNotice('私人空间已变化，已隐藏原空间内容。');}
   const value=await readPersonalFinanceSnapshot(fetch,nextOwner),after=await readPersonalFinanceStatus(fetch);
   if(!after.configured||scopeOf(after)!==nextScope)throw new PersonalFinanceClientError('私人空间已变化，请重新读取。',403);
   const retained=readPersonalFinanceCommand(sessionStorage,nextOwner);if(token!==generation.current)return;
   bindingRef.current=nextScope;setStatus(after);setSnapshot({scope:nextScope,value});setPending(retained);setRejectedKey(retained&&isRejected(retained)?retained.key:null);setVerified(true);
  }catch(cause){if(token===generation.current){setStatus(null);setSnapshot(null);setError(message(cause));}}
 }
 useEffect(()=>{
  void refresh();
  const visibility=()=>{if(document.visibilityState==='hidden'){generation.current++;setVerified(false);}else void refresh();};
  document.addEventListener('visibilitychange',visibility);return()=>{generation.current++;document.removeEventListener('visibilitychange',visibility);};
 },[]);
 useEffect(()=>{if(navigationGuard)navigationGuard.current=canLeave;const before=(event:BeforeUnloadEvent)=>{const current=editorRef.current;if(pendingRef.current||saving.current||current&&fingerprint(current.fields,current.amount)!==current.initial){event.preventDefault();event.returnValue='';}};window.addEventListener('beforeunload',before);return()=>{if(navigationGuard)navigationGuard.current=null;window.removeEventListener('beforeunload',before);};},[navigationGuard]);
 useEffect(()=>{if(typeof window.matchMedia!=='function')return;const media=window.matchMedia('(min-width:1024px) and (pointer:fine)'),update=()=>setRowEstimate(media.matches?40:52);update();media.addEventListener('change',update);return()=>media.removeEventListener('change',update);},[]);
 async function open(record:PersonalFinanceEntry|null){
  if(!owner||!shown||locked||!canLeave())return;setError('');setNotice('');const token=generation.current;
  if(!record){const fields=fresh();setEditor({scope:scope!,record:null,fields,amount:'',initial:fingerprint(fields,''),history:null});return;}
  setBusy(true);
  try{const before=await readPersonalFinanceStatus(fetch);if(!before.configured||scopeOf(before)!==scope)throw new PersonalFinanceClientError('私人空间已变化。',403);const [current,history]=await Promise.all([readPersonalFinanceRecord(fetch,owner,record.id),readPersonalFinanceHistory(fetch,owner,record.id)]);const after=await readPersonalFinanceStatus(fetch);if(!after.configured||scopeOf(after)!==scope)throw new PersonalFinanceClientError('私人空间已变化。',403);if(token!==generation.current)return;const fields=structuredClone(current.fields),amount=formatFinanceAmount(fields.amountMinor);setEditor({scope:scope!,record:current,fields,amount,initial:fingerprint(fields,amount),history});}
  catch(cause){if(token===generation.current)setError(message(cause));}finally{setBusy(false);}
 }
 function close(){if(busy)return;if(shownPending){setEditor(null);return;}if(canLeave())setEditor(null);}
 const edit=(patch:Partial<FinanceDraft>)=>setEditor(current=>current?{...current,fields:{...current.fields,...patch}}:current);
 function restore(command:PersonalFinanceCommand){const fields=structuredClone(command.body.fields),amount=formatFinanceAmount(fields.amountMinor);setEditor({scope:scopeOf(command.binding),record:null,fields,amount,initial:fingerprint(fields,amount),history:null});}
 async function send(command:PersonalFinanceCommand){
  if(saving.current||!writable||scopeOf(command.binding)!==scope)return;const token=generation.current;saving.current=true;setBusy(true);setError('');setRejectedKey(null);
  try{keepPersonalFinanceCommand(sessionStorage,command);setPending(command);const result=await sendPersonalFinanceCommand(fetch,sessionStorage,command);if(token!==generation.current)return;setPending(null);setEditor(null);setNotice(result.current.revision===result.receipt.revision?'流水已保存并独立读回。':'保存已确认，这条流水随后还有新版本。');await refresh();}
  catch(cause){if(token===generation.current){setError(message(cause));setRejectedKey(isRejected(command)?command.key:null);}}
  finally{saving.current=false;setBusy(false);}
 }
 async function save(){if(!shownEditor||!owner)return;try{const fields={...shownEditor.fields,amountMinor:financeAmountMinor(shownEditor.amount)};await send(shownPending??freezePersonalFinanceCommand(owner,fields,shownEditor.record,crypto.randomUUID()));}catch(cause){setError(message(cause));}}
 async function releaseRejected(discard=false){
  if(!shownPending||!shownRejected||!owner||busy)return;
  if(!discard&&shownPending.method==='PATCH'){await rebase();return;}
  const command=shownPending,token=generation.current;setBusy(true);
  try{const current=await readPersonalFinanceStatus(fetch);if(!current.configured||scopeOf(current)!==scope)throw new PersonalFinanceClientError('私人空间已变化。',403);if(token!==generation.current)return;clearPersonalFinanceCommand(sessionStorage,command);
   if(discard)setEditor(null);else{const draft=editorRef.current?.scope===scope?editorRef.current:null,fields=structuredClone(draft?.fields??command.body.fields),amount=draft?.amount??formatFinanceAmount(fields.amountMinor);setEditor({scope:scope!,record:null,fields,amount,initial:draft?.initial??fingerprint(fresh(),''),history:null});}
   setPending(null);setRejectedKey(null);setError('');setNotice(discard?'已放弃本次未保存的请求。':'已保留输入，请修改后重新保存。');await refresh();
  }catch(cause){if(token===generation.current){setError(message(cause));setRejectedKey(isRejected(command)?command.key:null);}}finally{setBusy(false);}
 }
 async function rebase(){
  if(!shownPending||shownPending.method!=='PATCH'||!owner||!shownRejected||busy)return;setBusy(true);const token=generation.current;
  try{const before=await readPersonalFinanceStatus(fetch);if(!before.configured||scopeOf(before)!==scope)throw new PersonalFinanceClientError('私人空间已变化。',403);const current=await readPersonalFinanceRecord(fetch,owner,shownPending.path.split('/').at(-1)!);const after=await readPersonalFinanceStatus(fetch);if(!after.configured||scopeOf(after)!==scope)throw new PersonalFinanceClientError('私人空间已变化。',403);if(token!==generation.current)return;clearPersonalFinanceCommand(sessionStorage,shownPending);const fields=structuredClone(shownPending.body.fields),amount=formatFinanceAmount(fields.amountMinor);setEditor({scope:scope!,record:current,fields,amount,initial:fingerprint(current.fields,formatFinanceAmount(current.fields.amountMinor)),history:null});setPending(null);setRejectedKey(null);setError('');setNotice('已读取最新版本并保留原输入，请核对后保存。');await refresh();}
  catch(cause){if(token===generation.current){setError(message(cause));setRejectedKey(isRejected(shownPending)?shownPending.key:null);}}finally{setBusy(false);}
 }
 const entries=useMemo(()=>shown?.entries.filter(entry=>(kind==='all'||entry.fields.kind===kind)&&(!search||(entry.fields.notes+'\n'+(entry.fields.category??'')+'\n'+(entry.fields.fromAccountRef??'')+'\n'+(entry.fields.toAccountRef??'')).normalize('NFKC').toLocaleLowerCase().includes(search.normalize('NFKC').toLocaleLowerCase())))??[],[shown,kind,search]);
 const summary=useMemo(()=>summarizeFinance(entries),[entries]);
 const columns=useMemo<ColumnDef<typeof dataGridFeatures,PersonalFinanceEntry>[]>(()=>[
  {id:'date',header:'日期',size:125,minSize:110,accessorFn:entry=>entry.fields.occurredOn},
  {id:'kind',header:'类型',size:90,minSize:80,accessorFn:entry=>financeKindLabels[entry.fields.kind]},
  {id:'notes',header:'摘要',size:250,minSize:170,meta:{fillWidth:true},accessorFn:entry=>entry.fields.notes||entry.fields.category||financeKindLabels[entry.fields.kind],cell:({row})=><Button variant="ghost" className={s.rowButton} onClick={()=>void open(row.original)} aria-label={`查看流水：${row.original.fields.occurredOn} ${financeKindLabels[row.original.fields.kind]} ${formatFinanceAmount(row.original.fields.amountMinor)}元`}>{row.original.fields.notes||row.original.fields.category||financeKindLabels[row.original.fields.kind]}</Button>},
  {id:'amount',header:'金额（CNY）',size:145,minSize:120,meta:{cellClassName:s.amount,headerClassName:s.amount},accessorFn:entry=>formatFinanceAmount(entry.fields.amountMinor)},
  {id:'category',header:'分类',size:120,minSize:90,accessorFn:entry=>entry.fields.category??'未分类'},
  {id:'accounts',header:'账户引用',size:190,minSize:140,accessorFn:entry=>[entry.fields.fromAccountRef,entry.fields.toAccountRef].filter(Boolean).join(' → ')||'未填写'},
 ],[scope,locked,verified,shown]);
 const table=useTable({features:dataGridFeatures,data:entries,columns,getRowId:entry=>entry.id,enableRowSelection:false,state:{pagination:{pageIndex:0,pageSize:Math.max(entries.length,1)}},autoResetPageIndex:false});
 const fields=shownEditor?.fields,expenses=shown?.entries.filter(entry=>entry.fields.kind==='expense'&&entry.id!==shownEditor?.record?.id)??[];
 const rejectedActions=shownPending&&shownRejected?<>{shownPending.method==='PATCH'?<Button type="button" variant="outline" disabled={busy} onClick={()=>void rebase()}>读取最新版本，保留输入</Button>:<Button type="button" variant="outline" disabled={busy} onClick={()=>void releaseRejected()}>继续编辑</Button>}<Button type="button" variant="outline" disabled={busy} onClick={()=>void releaseRejected(true)}>放弃本次保存</Button></>:null;
 return<section className={s.page} aria-label="财务记录">
  <div className={s.top}><div><h2>记录每一笔，清楚看收支</h2><p className={s.description}>个人录入的流水单独保存，账户余额暂未接入。</p></div><div className={s.actions}><Button variant="outline" disabled={busy||dirty||!!shownPending} onClick={()=>void refresh()}>刷新</Button><Button disabled={!writable||locked} onClick={()=>void open(null)}>记一笔</Button></div></div>
  {error&&<p role="alert" className={s.error}>{error}</p>}{notice&&verified&&<p role="status" className={s.notice}>{notice}</p>}
  {!verified&&!error&&<p role="status" className={s.empty}>正在核对本人财务记录…</p>}
  {verified&&status&&!status.configured&&<div className={s.empty}><h3>财务记录尚未开放</h3><p>{status.reason}</p></div>}
  {shownPending&&<div className={s.pending} role="status"><div><strong>{shownRejected?'这笔流水未保存':'有一笔保存等待确认'}</strong><p>{shownRejected?'保存已被明确拒绝，可保留输入继续修改，或放弃本次请求。':'原请求已保留，重试会使用同一个请求标识。'}</p></div>{rejectedActions}<Button variant="outline" disabled={busy||!writable} onClick={()=>{restore(shownPending);void send(shownPending);}}>重试原请求</Button></div>}
  {shown&&<>
   <div className={s.summary} aria-label="已读取流水汇总">{(['expense','income','refund'] as const).map(type=><article key={type}><span>已记录{financeKindLabels[type]}</span><strong>¥ {formatFinanceAmount(summary.byKind[type].totalMinor)}</strong><small>{summary.byKind[type].count} 笔</small></article>)}</div>
   <div className={s.coverage}><p>当前筛选净支出 <strong>¥ {formatFinanceAmount(summary.netExpenseMinor)}</strong> · 转账与还款不计入收支</p><p>个人录入 · 已读取 {shown.total} 条{shown.coverage.firstOccurredOn?` · ${shown.coverage.firstOccurredOn} 至 ${shown.coverage.lastOccurredOn}`:''} · 外部账本未连接 · 余额未知</p></div>
   <div className={s.toolbar}><div className={s.tabs} aria-label="财务视图"><Button variant="ghost" aria-pressed={view==='transactions'} onClick={()=>setView('transactions')}>流水</Button><Button variant="ghost" aria-pressed={view==='accounts'} onClick={()=>setView('accounts')}>账户与分类</Button></div>{view==='transactions'&&<div className={s.filters}><label className={s.search}>搜索<input value={search} placeholder="摘要、分类或账户" onChange={event=>setSearch(event.target.value)}/></label><label>流水类型<select value={kind} onChange={event=>setKind(event.target.value)}><option value="all">全部类型</option>{Object.entries(financeKindLabels).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label></div>}</div>
   {view==='transactions'?<><p className={s.muted}>显示 {entries.length} 条流水 · 点击摘要查看、修改与核对历史</p>{shown.total===0?<div className={s.empty}><h3>还没有个人流水</h3><p>从今天的一笔真实收支开始，保存后即可在这里回读。</p><Button disabled={!writable||locked} onClick={()=>void open(null)}>记第一笔</Button></div>:<div className={s.table} data-personal-finance-grid="reui"><DataGridContainer><DataGrid table={table} recordCount={entries.length} i18n={{labels:{empty:'没有符合筛选条件的流水'}}} tableLayout={{width:'fixed',headerSticky:true,columnsResizable:true,cellSelection:false}}><DataGridTableVirtual height="100%" estimateSize={rowEstimate} overscan={8}/></DataGrid></DataGridContainer></div>}</>:<div className={s.referenceGrid}><section><h3>已使用的账户引用</h3><p className={s.muted}>仅来自已保存流水，未据此推算余额。</p>{shown.accounts.length?<ul>{shown.accounts.map(account=><li key={account.reference}><span>{account.reference}</span><span className={s.muted}>余额未知</span></li>)}</ul>:<p className={s.emptySmall}>尚未填写账户引用。</p>}</section><section><h3>已使用的分类</h3>{shown.categories.length?<ul>{shown.categories.map(category=><li key={category}><span>{category}</span><span className={s.muted}>{shown.entries.filter(entry=>entry.fields.category===category).length} 笔</span></li>)}</ul>:<p className={s.emptySmall}>尚未填写分类。</p>}</section></div>}
  </>}
  <Dialog open={!!shownEditor} onOpenChange={open=>{if(!open)close();}}><DialogContent className={s.editor} showCloseButton={false} onEscapeKeyDown={event=>{if(busy)event.preventDefault();}} onPointerDownOutside={event=>{event.preventDefault();close();}} aria-describedby="finance-editor-description">
   <header><div><DialogTitle>{shownPending?shownRejected?'这笔流水未保存':'待确认的流水':shownEditor?.record?'流水详情':'记一笔'}</DialogTitle><DialogDescription id="finance-editor-description">明确金额与日期。保存后重新读取同一记录。</DialogDescription></div><Button variant="ghost" disabled={busy} onClick={close}>关闭</Button></header>
   {shownEditor&&fields&&<form onSubmit={event=>{event.preventDefault();void save();}}><fieldset disabled={locked||!writable}>
    <div className={s.formRow}><label>流水类型<select value={fields.kind} onChange={event=>edit({kind:event.target.value as FinanceDraft['kind'],originalEntryId:null})}>{Object.entries(financeKindLabels).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label><label>金额（元 · CNY）<input autoFocus required inputMode="decimal" value={shownEditor.amount} placeholder="0.00" onChange={event=>setEditor(current=>current?{...current,amount:event.target.value}:current)}/></label></div>
    <div className={s.formRow}><label>发生日期<input type="date" required value={fields.occurredOn} onChange={event=>edit({occurredOn:event.target.value})}/></label><label>分类（可选）<input maxLength={80} list="finance-category-options" value={fields.category??''} onChange={event=>edit({category:event.target.value||null})}/><datalist id="finance-category-options">{shown?.categories.map(category=><option key={category} value={category}/>)}</datalist></label></div>
    <label>摘要 / 备注<textarea aria-label="摘要 / 备注" rows={3} maxLength={16384} value={fields.notes} onChange={event=>edit({notes:event.target.value})}/></label>
    {fields.kind==='refund'&&<label>关联原支出<select required value={fields.originalEntryId??''} onChange={event=>edit({originalEntryId:event.target.value||null})}><option value="">选择本人同币种支出</option>{fields.originalEntryId&&!expenses.some(entry=>entry.id===fields.originalEntryId)&&<option value={fields.originalEntryId}>原关联支出（请重新核对）</option>}{expenses.map(entry=><option key={entry.id} value={entry.id}>{entry.fields.occurredOn} · {entry.fields.notes||entry.fields.category||'支出'} · ¥{formatFinanceAmount(entry.fields.amountMinor)}</option>)}</select></label>}
    <details open={fields.kind==='transfer'||fields.kind==='repayment'}><summary>账户引用{fields.kind==='transfer'||fields.kind==='repayment'?'（必填）':'（可选）'}</summary><div className={s.formRow}><label>付款账户<input required={fields.kind==='transfer'||fields.kind==='repayment'} maxLength={64} pattern="[A-Za-z0-9][A-Za-z0-9._:-]{0,63}" list="finance-account-options" value={fields.fromAccountRef??''} onChange={event=>edit({fromAccountRef:event.target.value||null})}/></label><label>收款账户<input required={fields.kind==='transfer'||fields.kind==='repayment'} maxLength={64} pattern="[A-Za-z0-9][A-Za-z0-9._:-]{0,63}" list="finance-account-options" value={fields.toAccountRef??''} onChange={event=>edit({toAccountRef:event.target.value||null})}/></label></div><datalist id="finance-account-options">{shown?.accounts.map(account=><option key={account.reference} value={account.reference}/>)}</datalist><p className={s.muted}>使用字母、数字或 . _ : - 命名账户引用；不包含卡号或密码。账户余额仍为未知。</p></details>
    {shownEditor.record&&<details><summary>来源与历史</summary><p className={s.provenance}>个人录入 · 版本 {shownEditor.record.revision}<br/>记录：{shownEditor.record.id}<br/>来源：{shownEditor.record.source.id}<br/>首次保存：{shownEditor.record.source.asOf}</p>{shownEditor.history&&<><p className={s.muted}>{shownEditor.history.complete?'已读回全部版本':'历史仅覆盖部分版本，未标记完整'}</p><ol className={s.history}>{shownEditor.history.entries.map(entry=><li key={entry.revision}><strong>版本 {entry.revision}</strong><span>{entry.fields.occurredOn} · {financeKindLabels[entry.fields.kind]} · ¥ {formatFinanceAmount(entry.fields.amountMinor)}</span><p>{entry.fields.notes||'未填写摘要'}</p></li>)}</ol></>}</details>}
   </fieldset>{error&&<p role="alert" className={s.error}>{error}</p>}{shownPending&&<p role="status" className={s.muted}>{shownRejected?'本次保存已拒绝，可继续编辑或放弃。':'原请求待确认，输入已锁定。'}</p>}<footer>{shownPending?<><Button type="button" disabled={busy||!writable} onClick={()=>void send(shownPending)}>重试原请求</Button>{rejectedActions}</>:<Button type="submit" disabled={busy||!writable}>{busy?'正在保存…':'保存流水'}</Button>}<Button type="button" variant="outline" disabled={busy} onClick={close}>{shownPending?'稍后处理':'取消'}</Button></footer></form>}
  </DialogContent></Dialog>
 </section>;
}
