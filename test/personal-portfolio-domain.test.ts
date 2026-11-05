import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
const domain = existsSync('src/personal-portfolio/model.ts') ? await import('../src/personal-portfolio/model.ts') : null;
const projection = existsSync('src/personal-portfolio/projection.ts') ? await import('../src/personal-portfolio/projection.ts') : null;
const pin={id:'11111111-1111-4111-8111-111111111111',sourceId:'22222222-2222-4222-8222-222222222222',revision:2};
const links={project:null,domain:null,topics:[]};
const account=(patch:Record<string,unknown>={})=>({type:'portfolio',schemaVersion:1,portfolioKind:'account',accountType:'checking',currency:'CNY',balanceMinor:null,asOf:null,links,...patch});
const asset=(patch:Record<string,unknown>={})=>({type:'portfolio',schemaVersion:1,portfolioKind:'asset',assetType:'property',currency:'CNY',valuationMinor:null,valuationOn:null,account:null,links,...patch});
const investment=(patch:Record<string,unknown>={})=>({type:'portfolio',schemaVersion:1,portfolioKind:'investment',symbol:null,name:null,quantity:null,currency:'CNY',costMinor:null,valuationMinor:null,asOf:null,account:null,asset:null,links,...patch});
const normalize=(personal:unknown)=>{assert.ok(domain,'portfolio normalizer is not implemented');return domain.normalizePortfolioPersonalFields({title:'  手工持有  ',text:'手工声明',occurredOn:null,personal});};

test('portfolio keeps unknown balances, valuations and quantities unknown and preserves decimal strings',()=>{
 const a=normalize(account()).personal;assert.ok(a.portfolioKind==='account');assert.equal(a.balanceMinor,null);
 const b=normalize(asset()).personal;assert.ok(b.portfolioKind==='asset');assert.equal(b.valuationMinor,null);
 const p=normalize(investment({quantity:'0001.2300',symbol:' ABC ',name:' 名称 '})).personal;
 assert.ok(p.portfolioKind==='investment');assert.equal(p.quantity,'0001.2300');assert.equal(p.symbol,'ABC');assert.equal(p.name,'名称');assert.equal(p.costMinor,null);
 assert.equal(normalize(account()).title,'手工持有');
});

test('portfolio requires exact integer minor money with matching known as-of dates and ISO currency precision',()=>{
 const a=normalize(account({balanceMinor:'-123',asOf:'2024-02-29'})).personal;assert.ok(a.portfolioKind==='account');assert.equal(a.balanceMinor,'-123');
 const b=normalize(asset({valuationMinor:'0',valuationOn:'2026-11-05'})).personal;assert.ok(b.portfolioKind==='asset');assert.equal(b.valuationMinor,'0');
 for(const patch of [{balanceMinor:'1'},{balanceMinor:1,asOf:'2026-11-05'},{balanceMinor:'1.23',asOf:'2026-11-05'},{balanceMinor:'01',asOf:'2026-11-05'},{balanceMinor:'-0',asOf:'2026-11-05'},{asOf:'2026-02-29'},{currency:'AAA'},{currency:'cny'},{balanceMinor:'1e2',asOf:'2026-11-05'}])assert.throws(()=>normalize(account(patch)));
 assert.throws(()=>normalize(asset({valuationMinor:'-1',valuationOn:'2026-11-05'})));
 assert.throws(()=>normalize(investment({quantity:'1e3'})));
 assert.throws(()=>normalize(investment({quantity:'-1'})));
 assert.throws(()=>normalize(investment({costMinor:'1'})));
 assert.ok(domain);
 assert.equal(domain.portfolioAmountMinor('123.45','CNY'),'12345');
 assert.equal(domain.portfolioAmountMinor('-12','JPY'),'-12');
 assert.equal(domain.portfolioAmountMinor('0.123','KWD'),'123');
 assert.equal(domain.formatPortfolioAmount('900719925474099301','CNY'),'9,007,199,254,740,993.01');
 assert.throws(()=>domain.portfolioAmountMinor('1.1','JPY'));
 assert.throws(()=>domain.portfolioAmountMinor('0.001','CNY'));
});

test('portfolio strict unions reject omitted fields, authority fields, wrong-kind data and malformed references',()=>{
 const valid=investment({account:pin,asset:{...pin,id:'33333333-3333-4333-8333-333333333333'},links:{project:pin,domain:null,topics:[]}});
 const p=normalize(valid).personal;assert.ok(domain);
 assert.deepEqual(domain.portfolioPersonalReferences(p),[{type:'portfolio',link:pin,expectedKinds:['account']},{type:'portfolio',link:valid.asset,expectedKinds:['asset']},{type:'project',link:pin}]);
 for(const key of Object.keys(account())){const v=account();delete v[key as keyof typeof v];assert.throws(()=>normalize(v),key);}
 for(const value of [account({ownerId:'x'}),account({valuationMinor:'1'}),investment({account:{...pin,revision:0}}),investment({account:{...pin,ownerId:'x'}}),investment({account:pin,asset:pin}),account({links:{...links,topics:[pin,pin]}})])assert.throws(()=>normalize(value));
 assert.throws(()=>domain.normalizePortfolioPersonalFields({title:'记录',text:'',occurredOn:'0000-01-01',personal:account()}));
});

test('portfolio totals deduplicate record revisions and keep overlapping account, asset and holdings in separate currency groups',()=>{
 assert.ok(projection,'portfolio summary is not implemented');
 const row=(id:string,revision:number,personal:unknown)=>({id,sourceId:pin.sourceId,revision,fields:normalize(personal)});
 const records=[row(pin.id,1,account({balanceMinor:'100',asOf:'2026-11-04'})),row(pin.id,2,account({balanceMinor:'900719925474099301',asOf:'2026-11-05'})),row('a',1,account({currency:'USD',balanceMinor:'200',asOf:'2026-11-05'})),row('b',1,asset({valuationMinor:'400',valuationOn:'2026-11-05',account:pin})),row('c',1,investment({valuationMinor:'300',asOf:'2026-11-05',account:pin})),row('d',1,account())];
 const result=projection.summarizePortfolio(records);
 assert.equal(result.recordCount,5);
 assert.deepEqual(result.groups.map((g:any)=>[g.portfolioKind,g.currency,g.knownTotalMinor,g.unknownCount]),[['account','CNY','900719925474099301',1],['account','USD','200',0],['asset','CNY','400',0],['investment','CNY','300',0]]);
 assert.equal('grandTotalMinor' in result,false);
 assert.equal('returnMinor' in result,false);
});
