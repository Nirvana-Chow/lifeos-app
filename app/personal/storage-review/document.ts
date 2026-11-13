// Owner review interface: same-origin saved snapshots, with optional local previews.
export const reviewDocument = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<meta name="robots" content="noindex, nofollow">
<title>存储审核</title>
<style>
:root{color-scheme:light;--ink:#18253a;--muted:#50627a;--surface:#fff;--paper:#f1f5fa;--line:#cbd6e3;--accent:#234cc0;--navy:#192c50;--keep:#135840;--keep-bg:#e6f5ec;--trash:#8a3625;--trash-bg:#fff0e9;--defer:#624500;--defer-bg:#fff5cf;font-family:system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif}
*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);line-height:1.55}.wrap{width:min(1480px,calc(100% - 48px));margin:auto}.mast{background:var(--navy);color:#fff;padding:40px 0 34px;border-bottom:6px solid #8ba8f7}.mast .wrap{display:grid;grid-template-columns:1fr minmax(230px,310px);gap:32px;align-items:end}.eyebrow{margin:0 0 5px;font-size:.85rem;color:#c9d8fa}.mast h1{font-size:clamp(2rem,5vw,3.2rem);letter-spacing:-.05em;line-height:1.08;margin:0 0 12px}.mast p{margin:0;max-width:55ch}.mast .summary{margin-top:10px;color:#dce6fc;white-space:pre-wrap;overflow-wrap:anywhere}.progress-box{padding:14px 17px;border:1px solid #6c83b2;border-radius:9px}.progress-box strong{font-size:1.3rem;font-variant-numeric:tabular-nums}.progress-box span{display:block;color:#dce6fc;font-size:.86rem}progress{display:block;width:100%;margin-top:8px;accent-color:#9ab5ff;height:9px}.controls{display:flex;flex-wrap:wrap;gap:10px;align-items:end;padding:18px 0 12px}.search{flex:1 1 230px}.filter{flex:0 1 166px}.controls label{display:block;color:var(--muted);font-size:.83rem;margin-bottom:4px}.controls input,.controls select,button{font:inherit;color:inherit;border:1px solid var(--line);border-radius:7px;background:var(--surface);min-height:44px;padding:7px 12px}.controls input,.controls select{width:100%}button{cursor:pointer}button:hover{border-color:var(--accent);color:var(--accent)}button:disabled{cursor:default;opacity:.6}button:focus-visible,input:focus-visible,select:focus-visible,summary:focus-visible{outline:3px solid #3d6ee4;outline-offset:3px}.actions{display:flex;gap:7px;flex-wrap:wrap}.primary{background:var(--accent);color:#fff;border-color:var(--accent)}.primary:hover{background:#173d9c;color:#fff}.meta{display:flex;flex-wrap:wrap;justify-content:space-between;gap:6px 16px;border-bottom:1px solid var(--line);padding-bottom:11px;color:var(--muted);font-size:.88rem}.note{min-height:1.6rem;margin:10px 0;color:var(--muted);font-size:.9rem}.group{margin:0 0 24px}.group h2{font-size:1rem;margin:0 0 7px;color:var(--navy);overflow-wrap:anywhere}.rows{background:var(--surface);border:1px solid var(--line);border-radius:10px;overflow:hidden}.row{display:grid;grid-template-columns:40px minmax(0,1fr) auto;gap:12px;padding:15px 16px;align-items:start;border-left:4px solid transparent}.row+.row{border-top:1px solid var(--line)}.row[data-decision=keep]{border-left-color:#28795c}.row[data-decision=trash]{border-left-color:#b55742}.row[data-decision=defer]{border-left-color:#a4771d}.row[data-status=protected],.row[data-status=processed]{background:#f8fafd}.icon{display:grid;place-items:center;height:36px;width:36px;border-radius:8px;color:var(--navy);background:#e9effb}.icon svg{width:21px;height:21px;fill:none;stroke:currentColor;stroke-width:1.6;stroke-linecap:round;stroke-linejoin:round}.rowhead{display:flex;flex-wrap:wrap;align-items:baseline;gap:4px 8px;margin:0 0 4px}.id{color:var(--accent);font-size:.82rem;font-weight:700}.row h3{font-size:1rem;line-height:1.42;margin:0;overflow-wrap:anywhere}.status{font-size:.76rem;color:var(--muted);border:1px solid var(--line);border-radius:99px;padding:1px 7px;white-space:nowrap}.body,.question{overflow-wrap:anywhere;white-space:pre-wrap;margin:6px 0 0;color:var(--muted);font-size:.9rem}.question{color:var(--ink)}details{margin-top:5px}summary{cursor:pointer;color:var(--accent);font-size:.85rem;min-height:30px;align-content:center}.choices{display:flex;flex-wrap:wrap;gap:5px;min-width:0}.choices label{position:relative;cursor:pointer}.choices input{position:absolute;opacity:0;width:1px;height:1px}.choices span{display:grid;place-items:center;padding:6px 9px;min-height:38px;background:#fff;border:1px solid var(--line);border-radius:6px;font-size:.84rem;white-space:nowrap}.choices input:focus-visible+span{outline:3px solid #3d6ee4;outline-offset:2px}.choices input[value=keep]:checked+span{color:var(--keep);background:var(--keep-bg);border-color:var(--keep);font-weight:700}.choices input[value=trash]:checked+span{color:var(--trash);background:var(--trash-bg);border-color:var(--trash);font-weight:700}.choices input[value=defer]:checked+span{color:var(--defer);background:var(--defer-bg);border-color:var(--defer);font-weight:700}.empty{padding:30px 18px;background:#fff;border:1px dashed var(--line);border-radius:8px;color:var(--muted)}footer{padding:6px 0 32px;color:var(--muted);font-size:.85rem;overflow-wrap:anywhere}dialog{width:min(550px,calc(100% - 32px));border:1px solid var(--line);border-radius:10px;padding:20px;color:var(--ink);background:var(--surface)}dialog::backdrop{background:#192c5088}dialog textarea{display:block;width:100%;min-height:180px;margin:12px 0;border:1px solid var(--line);font:inherit;padding:8px}
.pending-input{margin:12px 0;padding:16px;border:1px solid #a4771d;border-radius:8px;background:var(--defer-bg)}.pending-input[hidden]{display:none}.pending-input p{margin:6px 0 12px;overflow-wrap:anywhere}.ledger-head{display:grid;grid-template-columns:minmax(230px,1fr) minmax(280px,1.4fr) 260px;gap:24px;padding:12px 16px;color:var(--muted);font-size:.82rem}.group h2{padding:12px 0 2px}.row{grid-template-columns:36px minmax(0,1fr) 260px;gap:12px}.row-content{display:grid;grid-template-columns:minmax(160px,.8fr) minmax(240px,1.4fr);gap:24px}.rowhead{display:block}.rowhead .id{display:block;margin-bottom:4px}.rowhead .status{display:inline-block;margin-top:6px}.body{margin-top:0}.choices span{min-height:44px}.choices button{font-size:.8rem}.readonly{color:var(--muted);font-size:.85rem}.meta a{align-self:center}.note{padding:8px 0}.meta[data-sync=error]{color:var(--trash)}
.return-nav{display:flex;flex-wrap:wrap;gap:8px 20px;margin-bottom:20px}.return-nav a{color:#fff;min-height:44px;display:inline-flex;align-items:center}.return-nav a:focus-visible{outline:3px solid #9ab5ff;outline-offset:3px}.directory-children{margin:0;border-top:1px solid var(--line)}.directory-children>summary{padding:8px 16px;min-height:44px;font-weight:600}.child-rows{margin-left:20px;border-left:2px solid var(--line)}.row[data-context=true]{background:var(--paper)}.status{white-space:normal;overflow-wrap:anywhere}.evidence{margin:8px 0 0;color:var(--defer);font-size:.88rem;white-space:pre-wrap;overflow-wrap:anywhere}
@media(max-width:1100px){.ledger-head{display:none}.row-content{display:block}.rowhead{display:flex}.rowhead .id{margin:0}.rowhead .status{margin:0}.body{margin-top:6px}.row{grid-template-columns:36px minmax(0,1fr) 230px}}
@media(max-width:720px){.wrap{width:calc(100% - 28px)}.mast{padding:26px 0 22px}.mast .wrap{grid-template-columns:1fr;gap:15px}.controls{gap:8px}.search{flex-basis:52%}.filter{flex:1 1 110px}.actions{width:100%}.row{grid-template-columns:32px minmax(0,1fr);padding:12px 10px;gap:8px}.icon{width:30px;height:30px}.choices,.readonly{grid-column:2}.choices span{min-height:44px}.row h3{font-size:.96rem}}
@media(max-width:720px){.child-rows{margin-left:8px}.evidence,.status,.readonly{font-size:.875rem}.row .readonly{min-width:0}}
@media(max-width:370px){.actions button{padding-inline:8px}.choices span{padding-inline:6px}.row{grid-template-columns:26px minmax(0,1fr)}.icon{width:26px;height:26px}}
</style>
</head>
<body>
<header class="mast"><div class="wrap"><div><nav class="return-nav" aria-label="返回 LifeOS"><a href="/personal">← LifeOS 主站</a><a href="/personal?page=settings&amp;panel=general">设置与工具</a></nav><p class="eyebrow">资料去留清单</p><h1>存储审核</h1><p>按编号记录要保留、列为删除候选或暂缓的资料。</p><p class="summary" id="summary" hidden></p></div><section class="progress-box" aria-label="审核进度"><strong id="progress-text">0 / 0</strong><span id="progress-caption">已选决定，不代表已执行</span><progress id="progress" value="0" max="1" aria-label="已记录决定的进度"></progress></section></div></header>
<main class="wrap">
<div class="controls" aria-label="清单工具">
<div class="search"><label for="search">搜索资料</label><input id="search" type="search" placeholder="输入编号、名称或关键词" autocomplete="off"></div>
<div class="filter"><label for="filter">筛选</label><select id="filter"><option value="all">全部资料</option><option value="pending">尚未决定</option><option value="selected">已选决定</option><option value="keep">留</option><option value="trash">删除候选</option><option value="defer">暂缓</option><option value="processed">已处理／受保护</option></select></div>
<div class="filter"><label for="group-filter">分组</label><select id="group-filter"><option value="">全部分组</option></select></div>
<div class="actions"><button type="button" id="compact" aria-pressed="false">精简视图</button><button type="button" id="import">导入清单</button><button type="button" id="copy" disabled>复制编号</button><button type="button" class="primary" id="export" disabled>导出决定</button></div>
<input type="file" id="file" accept=".csv,.json,text/csv,application/json" hidden>
</div>
<div class="meta"><span id="sync-state">本机预览</span><div class="actions"><a href="/login" id="sync-login" hidden>重新登录</a><button type="button" id="open-server">打开 LifeOS 清单</button><button type="button" id="save-server" disabled>保存清单到 LifeOS</button></div></div>
<div class="meta"><span id="visible"></span><span id="counts"></span></div>
<p class="note" id="notice" role="status" aria-live="polite"></p>
<section class="pending-input" id="pending-input" hidden aria-labelledby="pending-title"><strong id="pending-title">待确认的选择</strong><p id="pending-description"></p><div class="actions"><button type="button" id="retry-decision">确认后重试保存</button><button type="button" id="discard-decision">放弃本次输入</button></div></section>
<div class="ledger-head" aria-hidden="true"><span>编号／资料名称</span><span>说明与空间依据</span><span>审核决定</span></div>
<div id="list"></div>
<footer><span id="revision"></span><br>审核选项只记录决定，不会删除文件。父目录保留历史选择，展开后逐项审核；选择删除候选表示待处理，不代表已删除。媒体上传与独立恢复核验须另有证据。可导出 JSON 留存。</footer>
</main>
<dialog id="copy-dialog" aria-labelledby="copy-title"><h2 id="copy-title">复制审核决定</h2><label for="copy-text">选中并复制以下编号</label><textarea id="copy-text" readonly></textarea><button type="button" id="close-copy">关闭</button></dialog>
<script type="application/json" id="review-data">{"schema":1,"revision":"empty","items":[]}</script>
<script>
'use strict';
const DECISIONS = Object.freeze({keep:'留',trash:'删除候选',defer:'暂缓'});
const KINDS = Object.freeze({file:'文件',folder:'文件夹',media:'媒体',app:'应用'});
const STATUS = Object.freeze({pending:'待审',processed:'已处理',protected:'受保护'});
const OWN = (value,key) => Object.prototype.hasOwnProperty.call(value,key);
const MAX_IMPORT_BYTES = 2 * 1024 * 1024;
const CSV_COLUMNS = ['schema','revision','summary','id','title','body','question','group','kind','status'];
function parseCsvReview(input) {
  if (input.length > MAX_IMPORT_BYTES) throw Error('清单超过 2 MiB。');
  const text = input.replace(/^\\uFEFF/,'');
  const rows = [];
  let row = [], value = '', quoted = false, closed = false;
  function field() {
    if (value.length > 32768 || row.length >= CSV_COLUMNS.length) throw Error('CSV 字段超限。');
    row.push(value);
    value = '';
    closed = false;
  }
  function line() {
    field();
    if (row.length !== CSV_COLUMNS.length) throw Error('CSV 列数有误。');
    rows.push(row);
    if (rows.length > 5001) throw Error('CSV 清单最多包含 5000 项。');
    row = [];
  }
  for (let i=0; i<text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c !== '"') value += c;
      else if (text[i+1] === '"') { value += '"'; i++; }
      else { quoted = false; closed = true; }
    } else if (c === ',') field();
    else if (c === '\\n') line();
    else if (c === '\\r' && text[i+1] === '\\n') { line(); i++; }
    else if (c === '"' && !value && !closed) quoted = true;
    else if (c === '"' || c === '\\r' || closed) throw Error('CSV 引号或换行格式有误。');
    else value += c;
    if (value.length > 32768) throw Error('CSV 字段超限。');
  }
  if (quoted) throw Error('CSV 引号未闭合。');
  if (row.length || value || closed) line();
  const header = rows.shift();
  if (!header || !CSV_COLUMNS.every((k,i)=>k === header[i])) throw Error('CSV 表头不符合审核清单格式。');
  if (!rows.length) throw Error('CSV 没有审核条目。');
  const [,revision,summary] = rows[0];
  const items = rows.map(([schema,rev,context,id,title,body,question,group,kind,status],i)=>{
    if (schema !== '1' || rev !== revision || (i && context)) throw Error('CSV 必须使用同一版本与 schema 1，摘要仅放第一项。');
    return {id,title,body,question,group,kind,status};
  });
  return parseReview({schema:1,revision,context:{summary},items});
}
function parseReview(input) {
  if (!input || input.schema !== 1 || typeof input.revision !== 'string' || !input.revision.trim() || input.revision.length > 250 || !Array.isArray(input.items)) throw Error('清单格式有误。请选择审核清单 JSON。');
  const ids = new Set();
  const items = input.items.map(item => {
    if (!item || typeof item.id !== 'string' || !item.id.trim() || /[\\r\\n\\t]/.test(item.id) || ids.has(item.id) || typeof item.title !== 'string' || !item.title.trim() || !OWN(KINDS,item.kind) || !OWN(STATUS,item.status)) throw Error('清单含重复编号或无效条目。');
    ids.add(item.id);
    const copy = {id:item.id,title:item.title,kind:item.kind,status:item.status};
    for (const k of ['body','question','group']) {
      if (item[k] != null && typeof item[k] !== 'string') throw Error('清单条目格式有误。');
      copy[k] = item[k] || '';
    }
    return copy;
  });
  return {schema:1,revision:input.revision,items,context:{summary:typeof input.context?.summary === 'string' ? input.context.summary : ''}};
}
const storageKey = revision => 'storage-review:v1:' + revision;
function readChoices(raw,review) {
  const result = new Map();
  if (raw === null) return result;
  const saved = JSON.parse(raw);
  if (!saved || saved.schema !== 1 || saved.revision !== review.revision || !Array.isArray(saved.choices)) throw Error('Invalid saved decisions');
  const valid = new Set(review.items.filter(item => item.status === 'pending').map(item => item.id));
  for (const row of saved.choices) {
    if (!row || typeof row.id !== 'string' || !OWN(DECISIONS,row.decision) || result.has(row.id)) throw Error('Invalid saved decision');
    if (valid.has(row.id)) result.set(row.id,row.decision);
  }
  return result;
}
function serialize(review, choices) {
  return {schema:1,revision:review.revision,choices:review.items.filter(i=>i.status==='pending' && choices.has(i.id)).map(i=>({id:i.id,decision:choices.get(i.id)}))};
}
function matches(item,query,filter,choices,group="") {
  const decision = choices.get(item.id);
  const statusMatch = filter === 'all' || (filter === 'selected' && item.status === 'pending' && !!decision) || (filter === 'pending' && item.status === 'pending' && !decision) || (filter === 'processed' && item.status !== 'pending') || (OWN(DECISIONS,filter) && item.status === 'pending' && decision === filter);
  return (!group || (item.group || '资料清单') === group) && statusMatch && (!query || [item.id,item.title,item.group,item.body,item.question,KINDS[item.kind]].some(v=>v.toLowerCase().includes(query)));
}
function reviewTree(items) {
  const nodes = new Map(items.map(item=>[item.id,{item,children:[]}]));
  const roots = [];
  const safe = id=>/^[A-Za-z0-9][A-Za-z0-9_:-]*(?:\\.[A-Za-z0-9_:-]+)*$/.test(id);
  for (const node of nodes.values()) {
    const id = node.item.id;
    const split = id.lastIndexOf('.');
    const parent = split > 0 && safe(id) ? nodes.get(id.slice(0,split)) : null;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  return {roots,nodes};
}
function filterReviewTree(items,query,filter,choices,group) {
  function select(node) {
    const children = node.children.map(select).filter(Boolean);
    const matched = matches(node.item,query,filter,choices,group);
    return matched || children.length ? {...node,hasChildren:node.children.length>0,matched,children} : null;
  }
  return reviewTree(items).roots.map(select).filter(Boolean);
}
function reviewProgress(items,choices) {
  const progress = {total:0,selected:0,keep:0,trash:0,defer:0,parentSelected:0};
  for (const node of reviewTree(items).nodes.values()) {
    const decision = choices.get(node.item.id);
    if (node.children.length) { if (decision) progress.parentSelected++; continue; }
    if (node.item.status !== 'pending') continue;
    progress.total++;
    if (decision) { progress.selected++; progress[decision]++; }
  }
  return progress;
}
function reviewStateLabel(item,decision,parent) {
  const status = item.status !== 'pending' ? STATUS[item.status]+' · ' : '';
  if (parent) return status+'父目录 · '+(decision ? '历史选择：'+DECISIONS[decision]+'（不代表已执行）' : '请展开后逐项决定');
  return status+(item.status !== 'pending' ? '只读' : decision === 'trash' ? '删除候选 · 待处理' : decision ? '已选：'+DECISIONS[decision] : '尚未决定');
}
function reviewEvidence(item) {
  return item.kind === 'media' ? '上传完成：未核实 · 独立恢复核验：未核实' : '';
}
const byId = id => document.getElementById(id);
const make = (tag, className, value) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (value != null) node.textContent = value;
  return node;
};
const paths = {
  file:'M6 3h8l4 4v14H6z M14 3v5h4 M9 12h6 M9 16h6',
  folder:'M3 7h7l2 2h9v11H3z M3 7V5h7l2 2h7v2',
  media:'M4 5h16v14H4z M10 9l5 3-5 3z',
  app:'M4 4h7v7H4z M13 4h7v7h-7z M4 13h7v7H4z M13 13h7v7h-7z'
};
function icon(kind) {
  const span = make('span','icon');
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns,'svg');
  svg.setAttribute('viewBox','0 0 24 24');
  svg.setAttribute('aria-hidden','true');
  const path = document.createElementNS(ns,'path');
  path.setAttribute('d',paths[kind]);
  svg.append(path);
  span.append(svg);
  return span;
}
const REVIEW_API = '/api/platform/personal/storage-review';
let review, choices = new Map(), compact = false;
const collapsedBranches = new Set();
let pendingDecision = null, syncStatus = 'saved';
let remote, synced = false, busy = false, uncertain = false, localSaved = true, sessionDenied = false;
let reviewScope = null, pendingRetained = false, recoveryBlocked = false, reviewGeneration = 0;
function announce(text) { byId('notice').textContent = text; }
function guardReviewNavigation(event) {
  if (!busy && !synced && !localSaved && choices.size) {
    if (confirm('本机决定尚未持久保存。取消后可先导出；继续离开将放弃仅在内存中的决定。仍要离开吗？')) return;
  } else if (!busy && pendingDecision && pendingRetained && retainPendingDecision()) {
    if (confirm('原请求已保留在本标签页的会话存储中，结果仍需核对。返回审核页或重新登录后可恢复同一请求，不会自动重发。仍要离开吗？')) return;
  } else if (!busy && pendingDecision?.outcome === 'new') {
    if (confirm('本次请求尚未发送，也未能可靠保存在本机。继续离开将放弃这份未提交草稿。仍要离开吗？')) return;
  } else if (!busy && !pendingDecision && !uncertain) return;
  event.preventDefault();
  announce(busy ? '正在保存或读回，请稍后返回 LifeOS。' : '已留在页面。未保存的决定可先导出；待核请求须可靠保留后才能离开。');
}
function reviewRecoveryKey(scope) {
  return 'lifeos.storage-review.pending.v1:'+encodeURIComponent(scope);
}
function parsePendingReview(raw,scope) {
  if (typeof raw !== 'string' || raw.length > 262144) throw Error('本机恢复记录无效。');
  const value = JSON.parse(raw), pending = value?.pending, command = pending?.command;
  const keys = (object,allowed)=>object && typeof object==='object' && !Array.isArray(object) && Object.keys(object).sort().join(',')===allowed.sort().join(',');
  if (!keys(value,['schema','scope','pending']) || value.schema!==1 || value.scope!==scope || !keys(pending,['id','decision','checklistRevision','scope','command','outcome']) || pending.scope!==scope || !['new','unknown','rejected','confirmed'].includes(pending.outcome) || !keys(command,['url','method','body','key']) || command.url!==REVIEW_API || !['PATCH','POST'].includes(command.method) || typeof command.body!=='string' || command.body.length>131072 || typeof command.key!=='string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/.test(command.key)) throw Error('本机恢复请求无效。');
  const body = JSON.parse(command.body);
  if (command.method==='PATCH') {
    if (!keys(body,['expectedRevision','checklistRevision','id','decision']) || !Number.isSafeInteger(body.expectedRevision) || body.expectedRevision<1 || typeof body.id!=='string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(body.id) || typeof body.checklistRevision!=='string' || !body.checklistRevision.trim() || body.checklistRevision.length>250 || !(body.decision===null || typeof body.decision==='string' && OWN(DECISIONS,body.decision)) || pending.id!==body.id || pending.decision!==body.decision || pending.checklistRevision!==body.checklistRevision) throw Error('本机决定恢复请求无效。');
  } else {
    if (!keys(body,['expectedRevision','checklist']) || !(body.expectedRevision===null || Number.isSafeInteger(body.expectedRevision) && body.expectedRevision>0) || pending.id!=='__checklist__' || pending.decision!==null || pending.checklistRevision!==body.checklist?.revision || parseReview(body.checklist).items.length>500) throw Error('本机清单恢复请求无效。');
  }
  return {...pending,outcome:pending.outcome==='new'?'unknown':pending.outcome,command:Object.freeze({...command})};
}
function retainPendingDecision() {
  pendingRetained = false;
  if (!pendingDecision?.scope) return false;
  try {
    const key = reviewRecoveryKey(pendingDecision.scope), raw = JSON.stringify({schema:1,scope:pendingDecision.scope,pending:pendingDecision});
    const old = sessionStorage.getItem(key);
    if (old && JSON.stringify(parsePendingReview(old,pendingDecision.scope).command)!==JSON.stringify(pendingDecision.command)) throw Error('另有待核请求。');
    sessionStorage.setItem(key,raw);
    pendingRetained = sessionStorage.getItem(key)===raw;
  } catch {
    try { const raw=sessionStorage.getItem(reviewRecoveryKey(pendingDecision.scope)); pendingRetained=!!raw && JSON.stringify(parsePendingReview(raw,pendingDecision.scope).command)===JSON.stringify(pendingDecision.command); } catch {}
  }
  return pendingRetained;
}
function restorePendingDecision() {
  const raw = sessionStorage.getItem(reviewRecoveryKey(reviewScope));
  pendingDecision = raw===null ? null : parsePendingReview(raw,reviewScope);
  pendingRetained = !!pendingDecision;
  if (pendingDecision) { uncertain=!['new','rejected'].includes(pendingDecision.outcome); syncStatus='error'; }
}
function clearPendingDecision() {
  if (pendingDecision?.scope) {
    try {
      const key = reviewRecoveryKey(pendingDecision.scope), raw = sessionStorage.getItem(key);
      if (raw && JSON.stringify(parsePendingReview(raw,pendingDecision.scope).command)===JSON.stringify(pendingDecision.command)) sessionStorage.removeItem(key);
    } catch {}
  }
  pendingDecision = null;
  pendingRetained = false;
}
async function readReviewScope() {
  const response = await fetch('/api/platform/personal/status',{credentials:'same-origin',cache:'no-store',redirect:'error',signal:AbortSignal.timeout(12000)});
  if (!response.ok) throw Object.assign(Error('本人空间尚未确认。'),{status:response.status});
  const value = await response.json();
  if (value?.scope!=='personal-manual-candidate' || value.storageVerified!==true || value.storageReviewEnabled!==true || typeof value.ownerId!=='string' || !value.ownerId || typeof value.spaceId!=='string' || !value.spaceId) throw Error('存储审核空间尚未确认。');
  return JSON.stringify([value.ownerId,value.spaceId]);
}
function useReview(next, snapshot, resetFilters=true) {
  synced = Boolean(snapshot);
  review = next;
  choices = snapshot ? new Map(snapshot.decisions.map(row=>[row.id,row.decision])) : new Map();
  if (!snapshot) {
    let raw = null;
    localSaved = true;
    try {
      raw = localStorage.getItem(storageKey(review.revision));
      choices = readChoices(raw,review);
      announce(review.items.length ? '决定保存在当前浏览器。' : '导入审核清单 CSV 或 JSON 后即可开始。');
    } catch {
      localSaved = false;
      if (raw !== null) {
        try { localStorage.removeItem(storageKey(review.revision)); } catch {}
        announce('原保存记录已损坏，已从空白决定开始。');
      } else {
        announce('当前浏览器无法保存决定，请及时导出。');
      }
    }
  }
  const selectedGroup = resetFilters ? '' : byId('group-filter').value;
  byId('group-filter').replaceChildren(make('option','','全部分组'));
  byId('group-filter').firstChild.value = '';
  for (const group of new Set(review.items.map(item=>item.group || '资料清单'))) {
    const option = make('option','',group); option.value = group; byId('group-filter').append(option);
  }
  byId('group-filter').value = selectedGroup;
  byId('summary').textContent = review.context.summary;
  byId('summary').hidden = !review.context.summary;
  byId('revision').textContent = '清单版本 ' + review.revision;
  if (resetFilters) {
    byId('search').value = '';
    byId('filter').value = 'all';
  }
  render();
}
function parseSnapshot(value) {
  if (value === null) return null;
  if (!value || !Number.isSafeInteger(value.revision) || value.revision < 1 || !Array.isArray(value.decisions)) throw Error('LifeOS 返回的清单无效。');
  const checklist = parseReview(value.checklist);
  const decisions = readChoices(JSON.stringify({schema:1,revision:checklist.revision,choices:value.decisions}),checklist);
  if (decisions.size !== value.decisions.length) throw Error('LifeOS 返回的决定无效。');
  return {revision:value.revision,checklist,decisions:[...decisions].map(([id,decision])=>({id,decision}))};
}
function freezeReviewCommand(method,body) {
  return Object.freeze({url:REVIEW_API,method,body:JSON.stringify(body),key:crypto.randomUUID()});
}
function decisionMatches(snapshot,pending) {
  const original = JSON.parse(pending.command.body);
  if (pending.command.method==='POST') return snapshot && JSON.stringify(snapshot.checklist)===JSON.stringify(original.checklist);
  return snapshot && snapshot.revision > original.expectedRevision && snapshot.checklist.revision === pending.checklistRevision &&
    (snapshot.decisions.find(row=>row.id===pending.id)?.decision ?? null) === pending.decision;
}
async function requestReview(method='GET',body,command) {
  if (body && !command) command = freezeReviewCommand(method,body);
  const generation = reviewGeneration, scope = reviewScope;
  if (command && (!scope || scope!==pendingDecision?.scope || await readReviewScope()!==scope)) throw Object.assign(Error('本人空间已变化。'),{status:403});
  const options = {method:command?.method ?? method,credentials:'same-origin',cache:'no-store',redirect:'error',signal:AbortSignal.timeout(12000)};
  if (body) {
    options.headers = {'Content-Type':'application/json','Idempotency-Key':command.key};
    options.body = command.body;
  }
  const response = await fetch(command?.url ?? REVIEW_API,options);
  if (!response.ok) throw Object.assign(Error('LifeOS 请求未成功。'),{status:response.status});
  const data = await response.json();
  const currentScope = scope ? await readReviewScope() : null;
  if (generation!==reviewGeneration || scope!==reviewScope || currentScope!==scope) throw Object.assign(Error('本人空间已变化。'),{status:403});
  return parseSnapshot(data.review);
}
function canEdit() { return !busy && !recoveryBlocked && (!synced || !uncertain && !!remote); }
function syncControls() {
  byId('open-server').disabled = busy;
  byId('save-server').disabled = busy || synced || uncertain || !!pendingDecision || remote === undefined || !review.items.length;
  byId('sync-login').hidden = !sessionDenied && !pendingDecision && !uncertain;
  byId('import').disabled = busy || !!pendingDecision;
  byId('file').disabled = busy || !!pendingDecision;
  byId('sync-state').textContent = (synced ? ({saving:'LifeOS 清单 · 正在保存并读回',saved:'LifeOS 已保存清单',error:'LifeOS 清单 · 保存未确认'}[syncStatus]) : '本机预览') + (uncertain ? ' · 请先重新读回' : '');
  byId('sync-state').parentElement.dataset.sync = syncStatus;
  const pending = pendingDecision;
  byId('pending-input').hidden = !pending || sessionDenied;
  if (pending && !sessionDenied) {
    const latest = choices.get(pending.id);
    byId('pending-description').textContent = pending.command.method==='POST' ? '本次清单保存尚未确认。' : pending.id + '：本次输入「' + (pending.decision === null ? '撤销决定' : DECISIONS[pending.decision]) + '」尚未确认。服务器当前为「' + (latest ? DECISIONS[latest] : '尚未决定') + '」。';
    byId('pending-description').textContent += pendingRetained ? ' 原请求已保留在本标签页的会话存储；可确认后返回或重新登录，回来后显式恢复同一请求。' : ' 原请求未能可靠保存在本机；请保留当前页面。';
    if (pending.outcome==='new') byId('pending-description').textContent += ' 尚未发送；这是未提交草稿。';
    byId('pending-description').textContent += pending.outcome === 'rejected' ? ' 原请求已明确拒绝，可按最新版本重新确认。' : pending.outcome === 'confirmed' ? ' 原请求已收到确认，读回后不会重复写入。' : ' 原请求结果未知，重试只会恢复原请求，不会覆盖为新的决定。';
    byId('retry-decision').textContent = pending.outcome === 'rejected' ? '按最新版本重新确认' : pending.outcome === 'confirmed' ? '确认原请求结果' : '按原请求重试确认';
    byId('retry-decision').disabled = busy || uncertain || recoveryBlocked || (pending.command.method==='POST' ? remote===undefined : !remote || review.revision !== pending.checklistRevision || !review.items.some(item=>item.id===pending.id && item.status==='pending'));
    byId('discard-decision').disabled = busy;
    byId('discard-decision').textContent = ['new','rejected'].includes(pending.outcome) ? '放弃本次输入' : '保留原请求，稍后核对';
  }
  for (const input of byId('list').querySelectorAll('.choices input,.choices button')) input.disabled = !canEdit() || !!pendingDecision;
}
const isSessionDenial = error => error?.status === 401 || error?.status === 403;
function hideDeniedServerReview() {
  reviewGeneration++;
  reviewScope = null;
  remote = undefined;
  uncertain = !!pendingDecision && !['new','rejected'].includes(pendingDecision.outcome);
  sessionDenied = true;
  byId('pending-description').textContent = '';
  if (synced) {
    const dialog = byId('copy-dialog');
    if (dialog.open) dialog.close();
    byId('copy-text').value = '';
    useReview(parseReview({schema:1,revision:'empty',items:[]}));
  }
  announce('请重新登录 LifeOS 后再查看服务器清单。仍可审核和导出本机清单。');
}
async function openServer(automatic=false) {
  if (busy) return;
  if (!automatic && !synced && choices.size && !confirm(localSaved ? '切换到 LifeOS 清单？本机决定仍保存在原清单版本。' : '本机决定尚未持久保存。可先取消并导出。仍切换到 LifeOS 清单吗？')) return;
  busy = true;
  const generation = ++reviewGeneration;
  syncControls();
  try {
    const scope = await readReviewScope();
    if (generation!==reviewGeneration) return;
    if (scope!==reviewScope) {
      if (reviewScope && synced) useReview(parseReview({schema:1,revision:'empty',items:[]}));
      reviewScope = scope;
      pendingDecision = null;
      pendingRetained = false;
      try { restorePendingDecision(); recoveryBlocked=false; } catch { recoveryBlocked=true; }
    }
    remote = await requestReview();
    if (generation!==reviewGeneration) return;
    uncertain = false;
    sessionDenied = false;
    if (remote) {
      useReview(remote.checklist,remote);
      syncStatus = pendingDecision ? 'error' : 'saved';
      announce(recoveryBlocked ? '本机会话恢复记录无法读取，已停止写入。现有本机记录未清除，可稍后重新登录核对。' : pendingDecision ? '已读回最新决定，请核对待确认的输入。' : '已打开 LifeOS 清单和服务器决定。');
    } else {
      announce('LifeOS 暂无保存的清单。可导入并保存，也可仅在本机审核。');
    }
  } catch (error) {
    if (isSessionDenial(error)) hideDeniedServerReview();
    else announce('暂时无法读取 LifeOS。可导入本机清单，稍后再读回。');
  } finally {
    busy = false;
    syncControls();
  }
}
async function writeServer(method,body,match,command) {
  busy = true;
  syncStatus = 'saving';
  syncControls();
  announce('正在保存并读回 LifeOS…');
  let failure;
  const pending = pendingDecision;
  const priorUnknown = pending?.outcome === 'unknown';
  try {
    const receipt = await requestReview(method,body,command);
    if (pending) { pending.outcome = match(receipt) ? 'confirmed' : 'unknown'; retainPendingDecision(); }
  } catch (error) {
    failure = error;
    if (pending) { pending.outcome = !priorUnknown && error?.status === 409 ? 'rejected' : 'unknown'; retainPendingDecision(); }
  }
  try {
    const fresh = await requestReview();
    remote = fresh;
    uncertain = false;
    sessionDenied = false;
    const agrees = fresh && match(fresh);
    const confirmed = pending?.outcome === 'confirmed';
    syncStatus = agrees || confirmed ? 'saved' : 'error';
    if (agrees || confirmed) clearPendingDecision();
    if (fresh && (synced || agrees)) useReview(fresh.checklist,fresh,false);
    if (agrees) {
      announce(failure ? '已读回 LifeOS 上的决定与清单。' : method === 'POST' ? '清单已保存到 LifeOS，并已读回。' : '决定已保存，并已读回 LifeOS。');
    } else if (confirmed) {
      announce('原请求已确认；最新服务器决定已有变化，已显示最新状态。可另行选择新的决定。');
    } else if (pending?.outcome === 'rejected' || !pending && failure?.status === 409) {
      announce('LifeOS 清单已变化，已读回最新状态。请核对后重试。');
    } else {
      announce('已读回 LifeOS，但未确认本次保存。请核对后重试。');
    }
  } catch (error) {
    syncStatus = 'error';
    if (isSessionDenial(error) || isSessionDenial(failure)) hideDeniedServerReview();
    else {
      uncertain = true;
      announce('尚未确认保存结果。请先打开 LifeOS 清单读回，再继续。');
    }
  } finally {
    busy = false;
    syncControls();
  }
}
async function savePreview() {
  if (busy || synced || uncertain || pendingDecision || recoveryBlocked || remote === undefined || !review.items.length) return;
  const checklist = review;
  const expectedRevision = remote?.revision ?? null;
  if (choices.size && !confirm(localSaved ? '本机决定将继续保留在浏览器，保存清单时不会同步这些决定。可先取消并导出。继续保存清单吗？' : '本机决定尚未持久保存，保存清单时不会同步这些决定。可先取消并导出。仍继续保存清单吗？')) return;
  if (remote && !confirm('保存到 LifeOS？若清单版本不同，将替换当前服务器清单及其决定。')) return;
  if (checklist.items.length > 500 || new TextEncoder().encode(JSON.stringify({expectedRevision,checklist})).length > 131072) {
    announce('清单超过 LifeOS 保存上限。仍可在本机审核和导出。');
    return;
  }
  const body = {expectedRevision,checklist};
  const pending = {id:'__checklist__',decision:null,checklistRevision:checklist.revision,scope:reviewScope,command:freezeReviewCommand('POST',body),outcome:'new'};
  pendingDecision = pending;
  if (!retainPendingDecision()) { render(); announce('原请求无法在本机保留，清单尚未发送。可重试或明确放弃未提交草稿。'); return; }
  await writeServer('POST',body,snapshot=>decisionMatches(snapshot,pending),pending.command);
}
function focusDecision(id,decision) {
  const row = [...byId('list').querySelectorAll('.row')].find(node=>node.dataset.id===id);
  (row && [...row.querySelectorAll('.choices input')].find(input=>input.value===decision) || row?.querySelector('.choices input') || byId('filter')).focus();
}
async function choose(item,decision) {
  if (pendingDecision) return;
  const node = reviewTree(review.items).nodes.get(item.id);
  if (!node || node.children.length) return;
  item = node.item;
  if (!canEdit() || item.status !== 'pending' || (choices.get(item.id) ?? null) === decision) return;
  if (synced) {
    const expectedRevision = remote.revision;
    const checklistRevision = review.revision;
    const body = {expectedRevision,checklistRevision,id:item.id,decision};
    const pending = {id:item.id,decision,checklistRevision,scope:reviewScope,command:freezeReviewCommand('PATCH',body),outcome:'new'};
    pendingDecision = pending;
    if (!retainPendingDecision()) { render(); announce('原请求无法在本机保留，决定尚未发送。可重试或明确放弃未提交草稿。'); return; }
    await writeServer('PATCH',body,snapshot=>decisionMatches(snapshot,pending),pending.command);
  } else {
    if (decision === null) choices.delete(item.id);
    else choices.set(item.id,decision);
    store();
    render();
  }
  if (canEdit()) focusDecision(item.id,decision);
}
function store() {
  try {
    localStorage.setItem(storageKey(review.revision),JSON.stringify(serialize(review,choices)));
    localSaved = true;
    announce('决定已保存。');
  } catch {
    localSaved = false;
    announce('当前浏览器无法保存决定，请先导出。');
  }
}
function metrics(shown) {
  const n = reviewProgress(review.items,choices);
  byId('progress-text').textContent = n.selected + ' / ' + n.total;
  byId('progress').max = n.total || 1;
  byId('progress').value = n.selected;
  byId('counts').textContent = '独立项／子项：留 '+n.keep+' · 删除候选（待处理） '+n.trash+' · 暂缓 '+n.defer+(n.parentSelected ? ' · 父目录历史选择 '+n.parentSelected : '');
  byId('visible').textContent = '显示 '+shown+' / '+review.items.length+' 项';
  byId('copy').disabled = byId('export').disabled = !choices.size;
}
function render() {
  const query = byId('search').value.trim().toLowerCase();
  const filter = byId('filter').value;
  const selectedGroup = byId('group-filter').value;
  const tree = filterReviewTree(review.items,query,filter,choices,selectedGroup);
  const shown = review.items.filter(item=>matches(item,query,filter,choices,selectedGroup));
  const parent = byId('list');
  parent.replaceChildren();
  metrics(shown.length);
  if (!tree.length) {
    parent.append(make('p','empty',review.items.length ? '没有符合条件的资料。试试修改关键词或筛选。' : '清单为空。请选择「导入清单」。'));
    syncControls();
    return;
  }
  const groups = new Map();
  for (const node of tree) {
    const group = node.item.group || '资料清单';
    if (!groups.has(group)) groups.set(group,[]);
    groups.get(group).push(node);
  }
  let index = 0;
  function appendNode(node,rows) {
    const item = node.item;
      const row = make('article','row');
      const decision = choices.get(item.id);
      const isParent = node.hasChildren;
      row.dataset.context = String(!node.matched);
      row.dataset.id = item.id;
      row.dataset.status = item.status;
      if (decision) row.dataset.decision = decision;
      row.append(icon(item.kind));
      const content = make('div','row-content');
      const head = make('div','rowhead');
      const heading = make('h3','',item.title);
      heading.id = 'item-title-' + index;
      head.append(make('span','id',item.id),heading,make('span','status',KINDS[item.kind]+' · '+reviewStateLabel(item,decision,isParent)));
      content.append(head);
      const evidence = reviewEvidence(item);
      const information = make(compact ? 'details' : 'div');
      if (compact && (item.body || item.question || evidence)) information.append(make('summary','','查看说明'));
      if (item.body) information.append(make('p','body',item.body));
      if (item.question) information.append(make('p','question',item.question));
      if (evidence) information.append(make('p','evidence',evidence));
      if (item.body || item.question || evidence) content.append(information);
      row.append(content);
      if (item.status === 'pending' && !isParent) {
        const buttons = make('div','choices');
        buttons.setAttribute('role','radiogroup');
        buttons.setAttribute('aria-labelledby',heading.id);
        for (const [value,label] of Object.entries(DECISIONS)) {
          const radio = make('input');
          radio.type = 'radio';
          radio.name = 'item-choice-' + index;
          radio.value = value;
          radio.checked = value === decision;
          const wrapper = make('label');
          wrapper.append(radio,make('span','',label));
          buttons.append(wrapper);
          radio.addEventListener('change',()=>{
            if (!radio.checked) return;
            for (const input of buttons.querySelectorAll('input')) input.checked = input.value === choices.get(item.id);
            void choose(item,value);
          });
        }
        if (decision) {
          const clear = make('button','','撤销决定');
          clear.type = 'button';
          clear.addEventListener('click',()=>void choose(item,null));
          buttons.append(clear);
        }
        row.append(buttons);
      } else {
        row.append(make('span','readonly',isParent ? '父目录仅作索引，请逐项审核子项' : STATUS[item.status]+' · 只读'));
      }
    rows.append(row);
    index++;
    if (node.children.length) {
      const branch = make('details','directory-children');
      branch.dataset.parentId = item.id;
      branch.open = !!query || filter !== 'all' || !!selectedGroup || !collapsedBranches.has(item.id);
      const summary = make('summary','','子项（'+node.children.length+'） · 展开／收起');
      branch.append(summary);
      const children = make('div','child-rows');
      for (const child of node.children) appendNode(child,children);
      branch.append(children);
      branch.addEventListener('toggle',()=>{if(branch.open)collapsedBranches.delete(item.id);else collapsedBranches.add(item.id);});
      rows.append(branch);
    }
  }
  for (const [name,nodes] of groups) {
    const section = make('section','group');
    section.append(make('h2','',name));
    const rows = make('div','rows');
    section.append(rows);
    for (const node of nodes) appendNode(node,rows);
    parent.append(section);
  }
  syncControls();
}
for (const link of document.querySelectorAll('.return-nav a,#sync-login')) link.addEventListener('click',guardReviewNavigation);
byId('search').addEventListener('input',render);
byId('filter').addEventListener('change',render);
byId('group-filter').addEventListener('change',render);
byId('discard-decision').addEventListener('click',()=>{
  if (busy) return;
  if (pendingDecision && !['new','rejected'].includes(pendingDecision.outcome)) {
    retainPendingDecision(); render(); announce(pendingRetained ? '原请求已保留，保存结果仍未知。可确认后返回或重新登录，稍后恢复同一请求。' : '原请求结果仍未知，未能可靠保留。请保留当前页面，恢复会话存储后再离开。'); return;
  }
  clearPendingDecision(); syncStatus = uncertain ? 'error' : 'saved'; render(); announce('已放弃未提交或已明确拒绝的输入，当前显示最近读回的服务器决定。');
});
async function retryDecision() {
  if (!pendingDecision || !canEdit() || pendingDecision.command.method!=='POST' && review.revision !== pendingDecision.checklistRevision) return;
  const pending = pendingDecision;
  const item = review.items.find(item=>item.id===pending.id && item.status==='pending');
  if (pending.command.method!=='POST' && !item) return;
  if (decisionMatches(remote,pending) || pending.outcome === 'confirmed') {
    clearPendingDecision(); syncStatus = 'saved'; render();
    announce(decisionMatches(remote,pending) ? '读回的决定已与本次输入一致。' : '原请求已确认；最新服务器决定已有变化，已显示最新状态。可另行选择新的决定。');
    return;
  }
  if (pending.outcome === 'rejected') {
    clearPendingDecision();
    if (pending.command.method==='POST') { announce('清单请求已明确拒绝。请核对最新清单，重新导入并确认保存。'); render(); }
    else await choose(item,pending.decision);
  } else {
    if (!retainPendingDecision()) { render(); announce('原请求无法在本机保留，尚未继续发送。请保留当前页面。'); return; }
    await writeServer(pending.command.method,JSON.parse(pending.command.body),snapshot=>decisionMatches(snapshot,pending),pending.command);
  }
}
byId('retry-decision').addEventListener('click',()=>{
  void retryDecision();
});
byId('compact').addEventListener('click',()=>{
  compact = !compact;
  byId('compact').setAttribute('aria-pressed',String(compact));
  byId('compact').textContent = compact ? '展开视图' : '精简视图';
  render();
});
byId('import').addEventListener('click',()=>byId('file').click());
byId('open-server').addEventListener('click',()=>void openServer());
byId('save-server').addEventListener('click',()=>void savePreview());
byId('file').addEventListener('change',async()=>{
  const file = byId('file').files[0];
  byId('file').value = '';
  if (!file || busy) return;
  if (!synced && choices.size && !localSaved && !confirm('本机决定尚未持久保存。可先取消并导出。仍打开另一份清单吗？')) return;
  try {
    if (file.size > MAX_IMPORT_BYTES) throw Error('清单超过 2 MiB。');
    const text = new TextDecoder('utf-8',{fatal:true}).decode(await file.arrayBuffer());
    if (busy) return;
    useReview(/\\.csv$/i.test(file.name) ? parseCsvReview(text) : parseReview(JSON.parse(text)));
  }
  catch(error) { announce(error instanceof SyntaxError ? '无法读取 JSON，请检查文件格式。' : error.message); }
});
byId('copy').addEventListener('click',async()=>{
  const text = serialize(review,choices).choices.map(i=>i.id+'\\t'+DECISIONS[i.decision]).join('\\n');
  try {
    await navigator.clipboard.writeText(text);
    announce('已复制编号和决定。');
  } catch {
    byId('copy-text').value = text;
    byId('copy-dialog').showModal();
    byId('copy-text').select();
  }
});
byId('close-copy').addEventListener('click',()=>byId('copy-dialog').close());
byId('export').addEventListener('click',()=>{
  const data = JSON.stringify(serialize(review,choices),null,2)+'\\n';
  const url = URL.createObjectURL(new Blob([data],{type:'application/json'}));
  const link = make('a');
  link.href = url;
  link.download = '存储审核决定.json';
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
  announce('已生成决定 JSON。');
});
const embedded = byId('review-data').textContent.trim();
try {
  useReview(parseReview(embedded.startsWith('{') ? JSON.parse(embedded) : {schema:1,revision:'empty',items:[]}));
} catch (error) {
  useReview(parseReview({schema:1,revision:'empty',items:[]}));
  announce(error.message);
}
void openServer(true);
</script>
</body>
</html>
`;
