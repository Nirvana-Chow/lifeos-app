'use client';
import {useState} from 'react';
import type {SessionDuration} from './policy';
import {parseSessionDuration} from './policy';
export function SessionDurationPicker({value,onChange}:{value:SessionDuration;onChange:(value:SessionDuration)=>void}){
 const [choice,setChoice]=useState('temporary'),[amount,setAmount]=useState('1'),[unit,setUnit]=useState('86400');
 function custom(nextAmount:string,nextUnit:string){setAmount(nextAmount);setUnit(nextUnit);const seconds=Number(nextAmount)*Number(nextUnit);try{parseSessionDuration({mode:'fixed',seconds});onChange({mode:'fixed',seconds});}catch{/* Native form validity blocks an invalid selection. */}}
 return <>
  <label>这台设备保持登录<select name="sessionDuration" value={choice} aria-describedby="session-duration-help" onChange={event=>{const next=event.target.value;setChoice(next);if(next==='rolling')onChange({mode:'rolling'});else if(next==='custom')custom(amount,unit);else onChange({mode:'fixed',seconds:next==='day'?86400:next==='week'?7*86400:1800});}}>
   <option value="temporary">30 分钟（临时登录）</option><option value="day">1 天</option><option value="week">7 天</option><option value="custom">自定义</option><option value="rolling">保持登录，直到退出或撤销</option>
  </select></label>
  {choice==='custom'&&<div><label>登录时长<input name="sessionDurationAmount" type="number" min="1" max={Math.floor(365*86400/Number(unit))} step="1" value={amount} required onChange={event=>custom(event.target.value,unit)}/></label><label>时间单位<select name="sessionDurationUnit" value={unit} onChange={event=>custom(amount,event.target.value)}><option value="60">分钟</option><option value="3600">小时</option><option value="86400">天</option></select></label></div>}
  <p id="session-duration-help">{value.mode==='rolling'?'仅在自己的设备选择。浏览器清理、账号安全变更或连续 400 天未使用后，可能需要重新登录。':'到期自动退出；访问和重新打开不会延长所选期限。保持登录也有浏览器最长 400 天的保留限制。'}</p>
 </>;
}
