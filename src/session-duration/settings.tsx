'use client';
import {useEffect,useState} from 'react';
import {safeSessionReturn} from './client';
import s from './session.module.css';
type Device={id:string;current:boolean;createdAt:string;expiresAt:string;userAgent:string;duration:{mode:'fixed'|'rolling';seconds:number}};
export function DeviceSessionsSettings(){
 const [devices,setDevices]=useState<Device[]|null>(null),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[reauth,setReauth]=useState(false),[unknown,setUnknown]=useState(false),[hidden,setHidden]=useState(false),[returnTo,setReturnTo]=useState('/personal?page=settings&panel=security');
 async function load(){setBusy(true);try{const response=await fetch('/api/platform/auth/device-sessions',{cache:'no-store',credentials:'same-origin'});if(response.status===404){setHidden(true);return;}const value=await response.json();if(!response.ok||!Array.isArray(value.sessions)||value.truncated!==false)throw Error();setDevices(value.sessions);setUnknown(false);setMessage('');}catch{setMessage('设备列表未能完整读取，请重试。');}finally{setBusy(false);}}
 useEffect(()=>{setReturnTo(safeSessionReturn(location.pathname+location.search));void load();},[]);
 async function revoke(device:Device){if(busy||unknown)return;if(!window.confirm(device.current?'退出这台设备？未保存的内容请先妥善保留。':'撤销这次设备登录？该会话将立即失效。'))return;setBusy(true);setMessage('');try{
  const response=await fetch('/api/platform/auth/device-sessions',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id:device.id})});
  if(response.status===403){setReauth(true);setMessage('撤销设备需要近期的两步验证；普通浏览仍可继续。');return;}
  if(!response.ok)throw Error();const result=await response.json();if(result.revoked!==true)throw Error();if(result.signedOut)window.location.replace('/login');else{setDevices(current=>current?.filter(item=>item.id!==device.id)??null);setMessage('已撤销该设备登录。');}
 }catch{setUnknown(true);setMessage('撤销结果未确认，请先重新读取设备列表。');}finally{setBusy(false);}}
 if(hidden)return null;
 return <section className={s.devices} aria-labelledby="device-sessions-title"><h3 id="device-sessions-title">已登录的设备</h3><p>每次登录分别保留所选期限。撤销后，该次登录立即失效；账号安全变更也会使相关登录失效。</p>{message&&<p role="status">{message}</p>}{reauth&&<a href={'/login?reauthenticate=1&return_to='+encodeURIComponent(returnTo)} target="_blank" rel="noopener">在新标签页完成两步验证</a>}<button type="button" disabled={busy} onClick={()=>void load()}>{busy?'正在核对…':'重新读取设备列表'}</button>{devices&&<ul>{devices.map(device=><li key={device.id}><strong>{device.current?'当前设备':'其他设备登录'}</strong><p>{device.userAgent||'浏览器信息不可用'}</p><p>登录时间：{new Date(device.createdAt).toLocaleString('zh-CN')}</p><p>{device.duration.mode==='rolling'?'保持登录；长期未使用时需重新验证':'固定期限'} · 到期时间：{new Date(device.expiresAt).toLocaleString('zh-CN')}</p><button type="button" disabled={busy||unknown} onClick={()=>void revoke(device)}>{device.current?'退出当前设备':'撤销这次登录'}</button></li>)}</ul>}</section>;
}
