'use client';
import{DraftEditor}from'./draft-workspace';
import{useEffect,useRef,useState,type FormEvent}from'react';import Link from'next/link';
import{Card,CardHeader,CardTitle,CardContent}from'../../components/ui/card';
import{publicAIConfigSchema,aiSecretInputSchema,type PublicAISettings}from'../platform/ai-settings-contract';
import{AISettingsClient,AISettingsRequestError,isAISettingsIdentityFailure}from'./ai-settings-client';import s from'./styles.module.css';

export function AISettings(){
 const[view,setView]=useState<PublicAISettings|null>(null),[model,setModel]=useState(''),[budget,setBudget]=useState(''),[secret,setSecret]=useState('');
 const[loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState(''),[confirmCost,setConfirmCost]=useState(false),[needsLogin,setNeedsLogin]=useState(false);
 const[concealed,setConcealed]=useState(true),[unconfirmed,setUnconfirmed]=useState(false),[testing,setTesting]=useState(false);
 const running=useRef(false),mounted=useRef(false),visible=useRef(false),access=useRef(false),epoch=useRef(0),client=useRef<AISettingsClient|null>(null),pending=useRef<{minimumRevision:number;connectionTest:boolean}|null>(null),testAbort=useRef<AbortController|null>(null);
 if(!client.current)client.current=new AISettingsClient(fetch);const renderEpoch=epoch.current;
 function apply(value:PublicAISettings,replaceDraft=true){setView(value);if(replaceDraft){setModel(value.config?.model??'');setBudget(value.config?.monthlyBudgetMinor===null||value.config?.monthlyBudgetMinor===undefined?'':(value.config.monthlyBudgetMinor/100).toFixed(2));}setNeedsLogin(false);}
 function conceal(){testAbort.current?.abort();setTesting(false);epoch.current++;access.current=false;setConcealed(true);setView(null);setModel('');setBudget('');setSecret('');setConfirmCost(false);setMessage('');setError('');setLoading(false);}
 function cancelConnection(){if(!testAbort.current)return;conceal();setMessage('已请求取消连接测试。请求可能已发送、计费或保存结果；请重新读取状态，不会自动重试。');}
 function editDraft(field:'model'|'budget'|'secret',value:string){if(testAbort.current){cancelConnection();return;}if(running.current||pending.current||loading||!access.current||!visible.current||renderEpoch!==epoch.current)return;epoch.current++;setMessage('');setError('');setConfirmCost(false);if(field==='model'){setModel(value);setSecret('');}else if(field==='budget'){setBudget(value);setSecret('');}else setSecret(value);}
 function failure(e:unknown){if(!mounted.current)return;if(isAISettingsIdentityFailure(e))conceal();setError(e instanceof AISettingsRequestError?e.message:'操作未完成，请重新读取。');if(e instanceof AISettingsRequestError&&(e.status===401||e.status===403))setNeedsLogin(true);}
 async function reload(){
  if(!mounted.current||document.visibilityState==='hidden')return;visible.current=true;conceal();const version=epoch.current;setLoading(true);const accepts=()=>mounted.current&&visible.current&&version===epoch.current;
  try{const value=await client.current!.request('settings');if(!accepts())return;apply(value);access.current=true;setConcealed(false);
   if(pending.current&&!running.current&&value.revision>=pending.current.minimumRevision&&(!pending.current.connectionTest||value.testState!=='pending')){pending.current=null;setUnconfirmed(false);setMessage('已重新读取更新后的配置，请核对当前状态。');}
   else if(pending.current)setMessage('上次操作结果仍未确认，请稍后重新读取；不会自动重复提交。');
  }catch(e){if(accepts()||mounted.current&&isAISettingsIdentityFailure(e))failure(e);}finally{if(accepts())setLoading(false);}
 }
 useEffect(()=>{mounted.current=true;const hide=()=>{visible.current=false;conceal();},focus=()=>{if(document.visibilityState!=='hidden')void reload();},visibility=()=>document.visibilityState==='hidden'?hide():focus();window.addEventListener('blur',hide);window.addEventListener('focus',focus);document.addEventListener('visibilitychange',visibility);focus();return()=>{mounted.current=false;visible.current=false;access.current=false;epoch.current++;testAbort.current?.abort();window.removeEventListener('blur',hide);window.removeEventListener('focus',focus);document.removeEventListener('visibilitychange',visibility);};},[]);
 async function mutate(path:string,method:string,body:unknown,label:string){
  if(running.current||pending.current||!access.current||!visible.current||renderEpoch!==epoch.current||!view)return;running.current=true;const command={minimumRevision:view.revision+1,connectionTest:path==='connection-test'},controller=command.connectionTest?new AbortController():null;pending.current=command;testAbort.current=controller;setTesting(!!controller);setUnconfirmed(true);setBusy(true);setError('');setMessage('');let committed=false;const version=epoch.current,accepts=()=>mounted.current&&visible.current&&access.current&&version===epoch.current;
  try{const result=await client.current!.request(path,method,body,accepts,controller?.signal);committed=true;command.minimumRevision=Math.max(command.minimumRevision,result.revision);if(!accepts())return;const readback=await client.current!.request('settings');if(!accepts())return;if(readback.revision<command.minimumRevision||command.connectionTest&&readback.testState==='pending')throw Error('Readback behind');const changedTest=command.connectionTest&&(readback.revision!==result.revision||JSON.stringify(readback.config)!==JSON.stringify(result.config)||readback.testState!=='passed');apply(readback,path==='settings'||changedTest);if(pending.current===command)pending.current=null;setUnconfirmed(false);setMessage(changedTest?'配置或测试状态已变化，已重新读取当前状态；请重新核对后再测试。':label+'，已重新读取确认。');}
  catch(e){if(!committed&&e instanceof AISettingsRequestError&&!e.uncertain&&pending.current===command){pending.current=null;if(mounted.current)setUnconfirmed(false);}if(mounted.current&&isAISettingsIdentityFailure(e))failure(e);else if(accepts()){if(committed)setError('操作已提交，但尚未读回最新状态。请重新读取，不要重复测试连接。');else failure(e);}}
  finally{running.current=false;if(testAbort.current===controller)testAbort.current=null;if(mounted.current){setSecret('');setConfirmCost(false);setBusy(false);setTesting(false);}}
 }
 function saveConfig(event:FormEvent){event.preventDefault();setError('');if(budget&&!/^\d+(\.\d{1,2})?$/.test(budget)){setError('预算使用非负金额，最多两位小数。');return;}
  const checked=publicAIConfigSchema.safeParse({provider:'volcengine-ark',baseURL:'https://ark.cn-beijing.volces.com/api/v3',model,dataScope:'current-message-only',monthlyBudgetMinor:budget?Math.round(Number(budget)*100):null});
  if(!checked.success){setError(checked.error.issues[0]?.message??'请核对配置。');return;}if(!view?.capabilities.configurationWritable){setMessage('字段格式已核对；服务器配置存储尚未启用，没有保存。');return;}
  void mutate('settings','PUT',{expectedRevision:view.revision,config:checked.data},'普通配置已保存');
 }
 function saveSecret(){if(!view)return;if(!aiSecretInputSchema.safeParse(secret).success){setError('请核对密钥格式，不要包含空白或换行。');return;}void mutate('secret','PUT',{expectedRevision:view.revision,secret},'密钥已加密保存');}
 const locked=busy||loading||unconfirmed,cap=view?.capabilities;
 const dirty=view?.config?model.trim()!==view.config.model||(!budget?null:Math.round(Number(budget)*100))!==view.config.monthlyBudgetMinor:!!model.trim()||!!budget;
 const testLabel=pending.current?.connectionTest?'本次测试结果未确认':dirty?'配置有未保存修改，请保存后重新测试':view?.testState==='passed'?(view.mode==='synthetic-sdk-test'?'SDK 合成测试通过':'连接测试通过'):view?.testState==='pending'?'上次测试待确认':view?.testState==='failed'?'上次测试失败':'尚未测试';
 if(concealed)return <div className={s.page}>
  <div className={s.pageHeader}><h1>AI 服务设置</h1><button className={s.buttonSecondary} disabled={loading} onClick={()=>void reload()}>重新读取</button></div>
  <Card className={s.panel}><CardHeader className={s.panelHead}><CardTitle><h2>{loading?'正在连接':'配置暂不可用'}</h2></CardTitle><span className={s.badge}>{loading?'核对中':'未连接'}</span></CardHeader><CardContent className={s.panelBody}>
   {error?<p className={s.error} role="alert">{error}</p>:<p role="status">{loading?'正在核对账号并读取配置…':'配置已隐藏，请恢复原账号后重新读取。'}</p>}
   {needsLogin&&<div className={s.actions}><Link className={s.button} href="/review/admin/login">前往评审登录</Link></div>}
   {message&&<p className={s.statusLine} role="status">{message}</p>}{unconfirmed&&<p className={s.statusLine} role="status">上次操作结果未确认，请重新读取，不要重复提交。</p>}
   <details className={s.help}><summary>连接与安全说明</summary><p>需要已验证的本人账号、安全 HTTPS 入口和服务端配置存储。当前不接收真实密钥，不调用模型。</p></details>
  </CardContent></Card>
  <DraftEditor kind="ai"/>
 </div>;
 return <div className={s.page}>
  <div className={s.pageHeader}><div><h1>AI 服务设置</h1></div><div className={s.actions}><span className={s.badge}>{view?.storage==='ready'?'配置存储已连接':loading?'读取中':'配置存储未就绪'}</span><button className={s.buttonSecondary} disabled={loading} onClick={()=>void reload()}>重新读取</button></div></div>
  {error&&<p className={s.error} role="alert">{error}{needsLogin&&<> <Link href="/review/admin/login">前往评审登录</Link></>}</p>}
  {message&&<p className={s.statusLine} role="status">{message}</p>}
  <div className={s.homeGrid}><div className={s.stack}>
   <Card className={s.panel}><CardHeader className={s.panelHead}><CardTitle><h2>服务配置</h2></CardTitle></CardHeader><CardContent className={s.panelBody}>
    <form className={s.form} onSubmit={saveConfig}><fieldset disabled={locked}>
     <label>服务商<select aria-label="服务商" value="volcengine-ark" onChange={()=>{}}><option value="volcengine-ark">火山引擎方舟</option></select></label>
     <details className={s.help}><summary>接口地址</summary><label>火山引擎方舟<input aria-label="接口地址" readOnly value="https://ark.cn-beijing.volces.com/api/v3"/></label></details>
     <label>模型 ID<input aria-label="模型 ID" value={model} maxLength={160} onChange={e=>editDraft('model',e.target.value)} placeholder="填写本人可用的模型 ID"/></label>
     <div className={s.twoColumns}><label>月预算参考（元，非硬限额）<input aria-label="月预算参考" inputMode="decimal" value={budget} onChange={e=>editDraft('budget',e.target.value)}/></label><label>读取范围<select aria-label="读取范围" defaultValue="current"><option value="current">仅当前消息</option></select></label></div>
     <button type="submit" className={s.button}>{cap?.configurationWritable?'保存配置':'检查字段'}</button>
    </fieldset></form>
   </CardContent></Card>
   <Card className={s.panel}><CardHeader className={s.panelHead}><CardTitle><h2>API Key</h2></CardTitle><span className={s.badge}>{view?.secretState==='stored'?'已保存 · '+view.secretMask:view?.secretState==='not-set'?'未设置':'尚未核实'}</span></CardHeader><CardContent className={s.panelBody}>
    <div className={s.form}><label>新增或替换密钥<input aria-label="API Key" type="password" autoComplete="new-password" spellCheck={false} value={secret} maxLength={8192} disabled={locked||!cap?.secretWritable||!view?.config||dirty} onChange={e=>editDraft('secret',e.target.value)} placeholder={view?.secretState==='stored'?'留空不修改现有密钥':'安全存储就绪后填写'}/></label>
     {dirty&&<p className={s.statusLine}>请先保存服务配置，再设置密钥或测试。</p>}<div className={s.actions}><button className={s.buttonSecondary} disabled={locked||!cap?.secretWritable||!view?.config||!secret||dirty} onClick={saveSecret}>保存密钥</button><button className={s.buttonSecondary} disabled={locked||view?.secretState!=='stored'} onClick={()=>{if(view&&confirm('移除密钥会停用 AI。确认移除？'))void mutate('secret','DELETE',{expectedRevision:view.revision},'密钥已移除');}}>移除密钥并停用</button></div>
    </div><details className={s.help}><summary>密钥保存规则</summary><p>密钥只传给本站服务端加密保存，网页只读取掩码。保存配置不会测试连接或启用模型。输入框在操作结束后清空，不写入浏览器存储。</p><p>当前 HTTP 或秘密存储未就绪时不接收真实 key。不要在聊天或普通文字输入框提交密钥。</p></details>
   </CardContent></Card>
   <Card className={s.panel}><CardHeader className={s.panelHead}><CardTitle><h2>测试与启用</h2></CardTitle></CardHeader><CardContent className={s.panelBody}>
    <label className={s.statusLine}><input type="checkbox" checked={confirmCost} disabled={locked||!cap?.connectionTestAvailable} onChange={e=>setConfirmCost(e.target.checked)}/> 我确认发送一条不含私人资料的连接测试，可能产生费用。</label>
    <div className={s.actions} style={{marginTop:16}}><button className={s.buttonSecondary} disabled={locked||!cap?.connectionTestAvailable||!confirmCost||dirty} onClick={()=>{if(view&&(view.testState!=='pending'||confirm('上次结果未确认，再次测试可能重复计费。继续？')))void mutate('connection-test','POST',{expectedRevision:view.revision,confirmCost:true},view.mode==='synthetic-sdk-test'?'SDK 合成测试已完成':'连接测试已完成');}}>{view?.testState==='pending'?'重新测试 · 可能再次计费':'测试连接'}</button><button className={s.button} disabled={locked||(!view?.enabled&&(!cap?.activationAvailable||dirty))} onClick={()=>{if(view)void mutate('activation','POST',{expectedRevision:view.revision,enabled:!view.enabled},view.enabled?'服务已停用':'服务已启用');}}>{view?.enabled?'停用服务':'启用服务'}</button></div>
    {testing&&<button type="button" className={s.buttonSecondary} onClick={cancelConnection}>取消连接测试</button>}
    <details className={s.help}><summary>费用与失败处理</summary><p>保存、测试、启用分开操作。启用后，明确选择 AI 预填或明确发送本轮聊天才调用；普通手工录入不调用。月预算目前用于记录，并非自动硬限额。</p><p>上次结果不明时先重新读取，不自动重发计费请求。取消不保证撤回已发送请求、费用或已保存的结果。配置或密钥变化后必须重新测试。</p><p><Link href="/review/admin/chat">前往 AI 聊天</Link></p></details>
   </CardContent></Card>
  </div><aside className={s.stack}><Card className={s.panel}><CardHeader className={s.panelHead}><CardTitle><h2>当前状态</h2></CardTitle></CardHeader><CardContent className={s.panelBody}><div className={s.summaryList}>{[['配置版本',view?.revision?String(view.revision):'尚未保存'],['服务',view?.enabled?(view.mode==='synthetic-sdk-test'?'仅合成测试已启用':'已启用'):'未启用'],['真实模型',view?.realModelActive?'已启用':'未接通'],['连接测试',testLabel]].map(([label,value])=><div className={s.summaryRow} key={label}><span>{label}</span><span>{value}</span></div>)}</div>{view?.notice&&<p className={s.statusLine} style={{marginTop:18}}>{view.notice}</p>}</CardContent></Card><Link className={s.buttonSecondary} href="/review/admin/capture">前往录入与审核</Link></aside></div>
 </div>;
}
