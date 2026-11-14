import assert from 'node:assert/strict';
import type {Page} from '@playwright/test';

// The original TLS/PG consumer and loopback regression execute the same probe.
// Closing its page before awaiting `finished` preserves Chromium's abort behavior.
export async function probeDisabledNoJsAuthForm(page:Page,options:{origin:string;route:'/login'|'/account/password';field:'password'|'currentPassword';stage:(value:string)=>void}){
 const {origin,route,field,stage}=options,routeLabel=route==='/login'?'login':'password';
 const classify=(value:string)=>{try{const u=new URL(value);return u.origin===origin&&u.pathname==='/login'?'login':u.origin===origin&&u.pathname==='/account/password'?'password':'other';}catch{return 'other';}};
 page.on('framenavigated',frame=>{if(frame===page.mainFrame())console.log('NO_JS_FRAME '+classify(frame.url()));});
 page.on('requestfailed',request=>{if(request.isNavigationRequest()&&request.frame()===page.mainFrame())console.log('NO_JS_REQUEST_FAILED '+classify(request.url())+' '+(request.failure()?.errorText?.match(/net::ERR_[A-Z_]+/)?.[0]??'OTHER'));});
 // An authenticated ordinary /login intentionally reopens the workspace. This
 // probe explicitly requests its form while retaining the canonical POST action.
 const entry=route==='/login'?'/login?reauthenticate=1':route;
 stage('no-js-'+routeLabel+'-load');await page.goto(origin+entry,{waitUntil:'domcontentloaded'});
 const form=page.locator('form');stage('no-js-'+routeLabel+'-form');assert.ok(await form.getAttribute('method')==='post'&&await form.getAttribute('action')===route,'no-js-form');
 stage('no-js-'+routeLabel+'-disabled');assert.ok(await page.locator('input[name="'+field+'"]') .isDisabled(),'no-js-disabled');
 stage('no-js-'+routeLabel+'-navigation');const navigation=page.waitForResponse(response=>response.request().isNavigationRequest()&&response.request().method()==='POST');
 await page.evaluate(name=>{const input=document.querySelector('input[name="'+name+'"]') as HTMLInputElement;input.value='synthetic-nojs-probe';(input.form as HTMLFormElement).requestSubmit();},field);
 const response=await navigation,request=response.request(),url=new URL(request.url());
 const facts={method:request.method()==='POST'?'POST':'OTHER',status:response.status(),originMatches:url.origin===origin,routeMatches:url.pathname===route,hasQuery:url.search!=='',hasMarker:(request.postData()??'').includes('synthetic-nojs-probe')};
 console.log('NO_JS_DIAGNOSTIC '+routeLabel+' '+JSON.stringify(facts));stage('no-js-'+routeLabel+'-response');assert.ok(facts.method==='POST'&&facts.originMatches&&facts.routeMatches&&!facts.hasQuery&&!facts.hasMarker&&facts.status>=400,'no-js-fallback');
 return {finished:(async():Promise<'failed'|'finished'>=>{try{return await response.finished()?'failed':'finished';}catch{return 'failed';}})()};
}
