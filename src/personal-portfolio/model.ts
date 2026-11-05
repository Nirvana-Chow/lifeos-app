import {object,PlatformError,validateId,validateRevision} from '../platform/domain.ts';
import {validateCalendarDate} from '../calendar-candidate/domain.ts';

export const portfolioKinds=['account','asset','investment'] as const;
export type PortfolioKind=typeof portfolioKinds[number];
export type PortfolioReference={id:string;sourceId:string;revision:number};
export type PortfolioLinks={project:PortfolioReference|null;domain:PortfolioReference|null;topics:PortfolioReference[]};
export const portfolioCurrencies={CNY:2,USD:2,HKD:2,EUR:2,GBP:2,JPY:0,KRW:0,TWD:2,AUD:2,CAD:2,CHF:2,SGD:2,KWD:3,BHD:3} as const;
export type PortfolioCurrency=keyof typeof portfolioCurrencies;
export const accountTypes=['checking','savings','cash','wallet','credit','brokerage','other'] as const;
export const assetTypes=['property','vehicle','collectible','equipment','other'] as const;
type Base={type:'portfolio';schemaVersion:1;currency:PortfolioCurrency;links:PortfolioLinks};
export type PortfolioAccount=Base&{portfolioKind:'account';accountType:typeof accountTypes[number];balanceMinor:string|null;asOf:string|null};
export type PortfolioAsset=Base&{portfolioKind:'asset';assetType:typeof assetTypes[number];valuationMinor:string|null;valuationOn:string|null;account:PortfolioReference|null};
export type PortfolioInvestment=Base&{portfolioKind:'investment';symbol:string|null;name:string|null;quantity:string|null;costMinor:string|null;valuationMinor:string|null;asOf:string|null;account:PortfolioReference|null;asset:PortfolioReference|null};
/** All amounts are exact minor-unit integer strings. Null means unknown, never zero. */
export type PersonalPortfolio=PortfolioAccount|PortfolioAsset|PortfolioInvestment;
export type PortfolioPersonal=PersonalPortfolio;
export type PortfolioPersonalFields={title:string;text:string;occurredOn:string|null;personal:PersonalPortfolio};
const invalid=(message='账户、资产或投资字段无效。'):never=>{throw new PlatformError(400,'INVALID_PORTFOLIO_FIELDS',message);};
function required(value:Record<string,unknown>,keys:readonly string[]){if(keys.some(key=>!Object.hasOwn(value,key)||value[key]===undefined))invalid('请提供完整字段；未知值请明确使用 null。');}
function nullableText(value:unknown,max=240):string|null{if(value===null)return null;if(typeof value!=='string'||value.length>max||value.includes('\0'))return invalid('文字过长或格式无效。');return value.trim()||null;}
function pin(value:unknown):PortfolioReference|null{if(value===null)return null;const v=object(value,['id','sourceId','revision']);required(v,['id','sourceId','revision']);return{id:validateId(v.id),sourceId:validateId(v.sourceId),revision:validateRevision(v.revision)};}
function links(value:unknown):PortfolioLinks{const v=object(value,['project','domain','topics']);required(v,['project','domain','topics']);if(!Array.isArray(v.topics)||v.topics.length>20)return invalid('最多关联20个主题。');const topics=v.topics.map(v=>pin(v)??invalid('主题引用无效。'));if(new Set(topics.map(v=>v.id)).size!==topics.length)return invalid('主题引用不能重复。');return{project:pin(v.project),domain:pin(v.domain),topics};}
function minor(value:unknown,negative=false):string|null{if(value===null)return null;if(typeof value!=='string'||!new RegExp(negative?'^-?(0|[1-9][0-9]{0,29})$':'^(0|[1-9][0-9]{0,29})$').test(value)||value==='-0')return invalid('金额需为精确的最小货币单位整数字符串。');return value;}
function date(value:unknown){return value===null?null:validateCalendarDate(value);}
function amountDate(amount:string|null,date:string|null){if(amount!==null&&date===null)invalid('填写金额后，请填写该余额或估值的日期。');}
export function emptyPortfolioPersonal(kind:PortfolioKind):PersonalPortfolio{
 const base={type:'portfolio' as const,schemaVersion:1 as const,currency:'CNY' as const,links:{project:null,domain:null,topics:[]}};
 if(kind==='account')return{...base,portfolioKind:kind,accountType:'checking',balanceMinor:null,asOf:null};
 if(kind==='asset')return{...base,portfolioKind:kind,assetType:'other',valuationMinor:null,valuationOn:null,account:null};
 if(kind==='investment')return{...base,portfolioKind:kind,symbol:null,name:null,quantity:null,costMinor:null,valuationMinor:null,asOf:null,account:null,asset:null};
 return invalid('请选择账户、资产或投资。');
}
export function validatePortfolioPersonal(input:unknown):PersonalPortfolio{
 if(!input||typeof input!=='object'||Array.isArray(input))return invalid();
 const kind=(input as Record<string,unknown>).portfolioKind;
 const extra=kind==='account'?['accountType','balanceMinor','asOf']:kind==='asset'?['assetType','valuationMinor','valuationOn','account']:kind==='investment'?['symbol','name','quantity','costMinor','valuationMinor','asOf','account','asset']:invalid();
 const keys=['type','schemaVersion','portfolioKind','currency','links',...extra],v=object(input,keys);required(v,keys);
 if(v.type!=='portfolio'||v.schemaVersion!==1||typeof v.currency!=='string'||!Object.hasOwn(portfolioCurrencies,v.currency))return invalid('请选择支持的币种与版本。');
 const base={type:'portfolio' as const,schemaVersion:1 as const,currency:v.currency as PortfolioCurrency,links:links(v.links)};
 if(kind==='account'){
  if(!accountTypes.includes(v.accountType as never))return invalid('账户类型无效。');
  const balanceMinor=minor(v.balanceMinor,true),asOf=date(v.asOf);amountDate(balanceMinor,asOf);
  return{...base,portfolioKind:kind,accountType:v.accountType as PortfolioAccount['accountType'],balanceMinor,asOf};
 }
 if(kind==='asset'){
  if(!assetTypes.includes(v.assetType as never))return invalid('资产类型无效。');
  const valuationMinor=minor(v.valuationMinor),valuationOn=date(v.valuationOn);amountDate(valuationMinor,valuationOn);
  return{...base,portfolioKind:kind,assetType:v.assetType as PortfolioAsset['assetType'],valuationMinor,valuationOn,account:pin(v.account)};
 }
 const quantity=v.quantity;
 if(quantity!==null&&(typeof quantity!=='string'||quantity.length>80||!/^\d+(?:\.\d+)?$/.test(quantity)))return invalid('持有数量需填写非负十进制字符串，不支持指数或自动舍入。');
 const costMinor=minor(v.costMinor),valuationMinor=minor(v.valuationMinor),asOf=date(v.asOf),account=pin(v.account),asset=pin(v.asset);
 amountDate(costMinor,asOf);amountDate(valuationMinor,asOf);
 if(account&&asset&&account.id===asset.id)return invalid('账户与资产不能引用同一条记录。');
 return{...base,portfolioKind:'investment',symbol:nullableText(v.symbol,80),name:nullableText(v.name),quantity:quantity as string|null,costMinor,valuationMinor,asOf,account,asset};
}
export function normalizePortfolioPersonalFields(input:unknown):PortfolioPersonalFields{
 const v=object(input,['title','text','occurredOn','personal']);required(v,['title','text','occurredOn','personal']);
 const title=nullableText(v.title);if(title===null)return invalid('请填写账户、资产或投资名称。');
 if(typeof v.text!=='string'||v.text.length>16384||v.text.includes('\0'))return invalid('说明过长或无效。');
 return{title,text:v.text,occurredOn:date(v.occurredOn),personal:validatePortfolioPersonal(v.personal)};
}
/** Root verifies ownership, target kind, current source/revision and reference locks before write. */
export type PortfolioPersonalReference={type:'portfolio';link:PortfolioReference;expectedKinds:readonly ('account'|'asset')[]}|{type:'project'|'domain'|'topic';link:PortfolioReference};
export function portfolioPersonalReferences(p:PersonalPortfolio):PortfolioPersonalReference[]{
 return[...('account'in p&&p.account?[{type:'portfolio' as const,link:p.account,expectedKinds:['account' as const]}]:[]),...('asset'in p&&p.asset?[{type:'portfolio' as const,link:p.asset,expectedKinds:['asset' as const]}]:[]),...(p.links.project?[{type:'project' as const,link:p.links.project}]:[]),...(p.links.domain?[{type:'domain' as const,link:p.links.domain}]:[]),...p.links.topics.map(link=>({type:'topic' as const,link}))];
}
/** Parse displayed major units with currency-specific precision, without floating point. */
export function portfolioAmountMinor(value:string,currency:PortfolioCurrency):string{
 const precision=portfolioCurrencies[currency];if(precision===undefined||typeof value!=='string'||!/^\-?\d+(?:\.\d+)?$/.test(value))return invalid('金额格式无效。');
 const negative=value.startsWith('-'),[whole,fraction='']=value.replace(/^-/,'').split('.');
 if(fraction.length>precision||whole.length>30)return invalid(`该币种最多支持${precision}位小数。`);
 const amount=BigInt(whole)*10n**BigInt(precision)+BigInt(fraction.padEnd(precision,'0')||'0');
 const result=(negative&&amount!==0n?'-':'')+amount.toString();minor(result,true);return result;
}
export function formatPortfolioAmount(value:string,currency:PortfolioCurrency,group=true):string{
 const precision=portfolioCurrencies[currency],amount=BigInt(value),absolute=amount<0n?-amount:amount,scale=10n**BigInt(precision);
 const whole=(absolute/scale).toString(),integer=group?whole.replace(/\B(?=(\d{3})+(?!\d))/g,','):whole;
 return`${amount<0n?'-':''}${integer}${precision?'.'+String(absolute%scale).padStart(precision,'0'):''}`;
}
