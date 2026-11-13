'use client';
import {useEffect,useRef,useState,type FormEvent} from 'react';
import {MfaCodeForm} from './mfa-code-form';
import {parseMfaSetup,type MfaSetup} from './owner-mfa-flow';
import s from './workspace.module.css';
import m from './owner-mfa.module.css';

export function OwnerMfaPanel({mode,oauthQuery}:{mode:'start'|'verify'|'incomplete'|'relogin'|'unavailable';oauthQuery?:string}){
 const suffix=oauthQuery?'?oauth_query='+encodeURIComponent(oauthQuery):'';
 const [setup,setSetup]=useState<MfaSetup|null>(null),[saved,setSaved]=useState(false),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[hydrated,setHydrated]=useState(false),[startAgain,setStartAgain]=useState(false),canvas=useRef<HTMLCanvasElement>(null);
 useEffect(()=>{setHydrated(true);},[]);
 useEffect(()=>{let active=true;if(setup&&canvas.current){import('qrcode').then(module=>{if(active&&canvas.current)return module.toCanvas(canvas.current,setup.uri,{width:240,margin:4,errorCorrectionLevel:'M'});}).catch(()=>{if(active)setMessage('二维码未能显示，请使用下方手动设置密钥。');});}return()=>{active=false;};},[setup]);
 async function enable(event:FormEvent<HTMLFormElement>){event.preventDefault();if(!hydrated||busy)return;const form=event.currentTarget,password=new FormData(form).get('password');setBusy(true);setMessage('');
  try{const response=await fetch('/api/platform/auth/two-factor/enable',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({password,method:'totp'})});form.reset();if(!response.ok){setMessage(response.status===429?'尝试过于频繁，请稍后再试。':'绑定未能开始，请核对密码或重新登录。');return;}setSetup(parseMfaSetup(await response.json()));setSaved(false);setStartAgain(false);
  }catch{form.reset();setMessage('绑定结果未确认，请重新登录后确认，不要重复提交。');}finally{setBusy(false);}
 }
 async function leave(){if(!hydrated||busy)return;setBusy(true);setSetup(null);try{const response=await fetch('/api/platform/auth/sign-out',{method:'POST',headers:{'content-type':'application/json'},body:'{}'});if(response.ok)window.location.replace('/login'+suffix);else setMessage('退出结果未确认，请稍后重新打开登录页确认。');}catch{setMessage('退出结果未确认，请稍后重新打开登录页确认。');}finally{setBusy(false);}}
 const enabled=mode!=='unavailable',start=(mode==='start'||mode==='verify'&&startAgain)&&!setup,needsSaved=!!setup||mode==='verify'||mode==='incomplete';
 return <main data-lifeos-surface="auth" className={s.page+' '+s.auth}><h1>LifeOS</h1><section className={s.panel}>
  <h2>{mode==='relogin'?'请重新完成两步登录':'绑定验证器'}</h2>
  {message&&<p role="status">{message}</p>}
  {mode==='unavailable'?<p>安全验证暂不可用，私有数据保持关闭。请稍后再试。</p>:mode==='relogin'?<p>当前会话尚未通过第二步验证。请退出，再使用密码和验证器动态码登录。</p>:<>
   <p>绑定并验证成功后，才能进入你的私人空间。公司电脑只需要浏览器，动态码可在手机的苹果「密码」App 中查看。</p>
   {start&&<form method="post" action="/account/mfa" onSubmit={enable}><fieldset disabled={!hydrated||busy}><label>账号密码<input name="password" type="password" autoComplete="current-password" required/></label><button className={s.primary}>{busy?'正在生成…':'生成绑定信息'}</button></fieldset></form>}
   {setup&&<div className={m.setup}>
    <p>在苹果「密码」中打开本站账号，选择“设置验证码”，扫描下方二维码或输入手动设置密钥。</p>
    <canvas ref={canvas} width={240} height={240} aria-label="验证器绑定二维码" className={m.qr}/>
    <p>手动设置密钥：<code id="mfa-setup-key" className={m.secret}>{setup.secret}</code></p>
    <h3>备用恢复码</h3><p>每组只能使用一次。请另存到安全位置，离开本页后不再显示。</p>
    <ul aria-label="备用恢复码" className={m.codes}>{setup.backupCodes.map(code=><li key={code}><code>{code}</code></li>)}</ul>
    <label className={m.ack}><input type="checkbox" checked={saved} onChange={event=>setSaved(event.target.checked)}/>我已妥善保存备用恢复码</label>
   </div>}
   {!setup&&!start&&(mode==='verify'||mode==='incomplete')&&<label className={m.ack}><input type="checkbox" checked={saved} disabled={!hydrated||busy} onChange={event=>setSaved(event.target.checked)}/>我已妥善保存此前显示的备用恢复码</label>}
   {(setup||!start)&&<MfaCodeForm disabled={needsSaved&&!saved} onSuccess={()=>{setSetup(null);window.location.replace('/account/mfa'+suffix);}}/>}
   {mode==='verify'&&!setup&&!startAgain&&<button type="button" disabled={!hydrated||busy} onClick={()=>setStartAgain(true)}>未保存绑定信息？重新生成</button>}
  </>}
  {enabled&&<p><button type="button" disabled={!hydrated||busy} onClick={leave}>退出并返回登录</button></p>}
 </section></main>;
}
