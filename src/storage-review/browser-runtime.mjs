// Keep this controller self-contained: the standalone route hashes and runs its function source.
/** @param {Document | HTMLElement} root */
export function mountStorageReview(root, host = false) {
const controller = new AbortController();
const fetch = (url, options) => globalThis.fetch(url, {
  ...options, signal: AbortSignal.any([controller.signal, options.signal]),
});
const DECISIONS = Object.freeze({keep:'留',trash:'删除候选',defer:'暂缓'});
const KINDS = Object.freeze({file:'文件',folder:'文件夹',media:'媒体',app:'应用'});
const STATUS = Object.freeze({pending:'待审',processed:'已处理',protected:'受保护'});
const OWN = (value,key) => Object.prototype.hasOwnProperty.call(value,key);
const MAX_IMPORT_BYTES = 2 * 1024 * 1024;
const CSV_COLUMNS = ['schema','revision','summary','id','title','body','question','group','kind','status'];
function parseCsvReview(input) {
  if (input.length > MAX_IMPORT_BYTES) throw Error('清单超过 2 MiB。');
  const text = input.replace(/^\uFEFF/,'');
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
    else if (c === '\n') line();
    else if (c === '\r' && text[i+1] === '\n') { line(); i++; }
    else if (c === '"' && !value && !closed) quoted = true;
    else if (c === '"' || c === '\r' || closed) throw Error('CSV 引号或换行格式有误。');
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
    if (!item || typeof item.id !== 'string' || !item.id.trim() || /[\r\n\t]/.test(item.id) || ids.has(item.id) || typeof item.title !== 'string' || !item.title.trim() || !OWN(KINDS,item.kind) || !OWN(STATUS,item.status)) throw Error('清单含重复编号或无效条目。');
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
const storageKey = revision => 'storage-review:v1:' + (host ? encodeURIComponent(reviewScope)+':' : '') + revision;
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
  const safe = id=>/^[A-Za-z0-9][A-Za-z0-9_:-]*(?:\.[A-Za-z0-9_:-]+)*$/.test(id);
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
const byId = id => root.querySelector('#'+id);
const ownEvent = {signal:controller.signal};
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
let noteDrafts = new Map(), noteDraftScope = null, noteDraftsReliable = true, noteDraftCorrupt = false;
function announce(text) { byId('notice').textContent = text; }
function noteDraftKey(scope) {
  return 'lifeos.storage-review.note-drafts.v1:'+encodeURIComponent(scope);
}
function retainNoteDrafts() {
  noteDraftsReliable = false;
  if (!noteDraftScope || noteDraftScope!==reviewScope) return false;
  try {
    const raw = JSON.stringify({schema:1,scope:noteDraftScope,drafts:[...noteDrafts].map(([id,draft])=>({id,...draft}))});
    if (raw.length>262144) throw Error('备注草稿过大。');
    const key = noteDraftKey(noteDraftScope);
    sessionStorage.setItem(key,raw);
    noteDraftsReliable = sessionStorage.getItem(key)===raw;
  } catch {}
  return noteDraftsReliable;
}
function loadNoteDrafts(scope) {
  if (noteDraftScope===scope) return;
  noteDrafts = new Map(); noteDraftScope = scope; noteDraftsReliable = true; noteDraftCorrupt = false;
  try {
    const raw = sessionStorage.getItem(noteDraftKey(scope));
    if (raw===null) return;
    if (raw.length>262144) throw Error('Invalid drafts');
    const data = JSON.parse(raw);
    if (data?.schema!==1 || data.scope!==scope || !Array.isArray(data.drafts) || data.drafts.length>500) throw Error('Invalid drafts');
    for (const d of data.drafts) {
      if (!d || Object.keys(d).sort().join(',')!=='checklistRevision,expectedRevision,id,note' || typeof d.id!=='string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(d.id) || noteDrafts.has(d.id) || typeof d.note!=='string' || d.note.includes('\0') || d.note.length>8000 || typeof d.checklistRevision!=='string' || !d.checklistRevision || d.checklistRevision.length>128 || !Number.isSafeInteger(d.expectedRevision) || d.expectedRevision<1) throw Error('Invalid drafts');
      noteDrafts.set(d.id,{note:d.note,checklistRevision:d.checklistRevision,expectedRevision:d.expectedRevision});
    }
  } catch { noteDrafts = new Map(); noteDraftsReliable = false; noteDraftCorrupt = true; recoveryBlocked = true; }
}
function updateNoteDraft(id,note,reconfirm=false) {
  const previous = noteDrafts.get(id);
  const baseline = previous && reconfirm!==true ? previous : {checklistRevision:review.revision,expectedRevision:remote.revision};
  noteDrafts.set(id,{note,checklistRevision:baseline.checklistRevision,expectedRevision:baseline.expectedRevision});
  return retainNoteDrafts();
}
function clearNoteDraft(pending) {
  const body = JSON.parse(pending.command.body);
  if (noteDraftScope===pending.scope && noteDrafts.get(pending.id)?.note===body.note) {
    noteDrafts.delete(pending.id); retainNoteDrafts();
  }
}
function guardNoteNavigation(event) {
  if (pendingDecision || busy || !noteDrafts.size) return;
  if (noteDraftsReliable && retainNoteDrafts() && confirm('备注草稿已保留在本标签页，尚未保存到 LifeOS。返回审核页后可继续编辑。仍要离开吗？')) return;
  event.preventDefault(); announce('已保留备注草稿。请先保存，或确认可靠保留后再离开。');
}
function guardReviewNavigation(event) {
  if (!busy && pendingDecision && !['new','rejected'].includes(pendingDecision.outcome)) {
    if (pendingRetained && retainPendingDecision() && confirm('原请求已保留在本标签页的会话存储中，结果仍需核对。返回审核页或重新登录后可恢复同一请求，不会自动重发。'+(!synced && !localSaved && choices.size ? ' 继续离开也将放弃仅在内存中的本机决定，可先取消并导出。' : '')+'仍要离开吗？')) return;
  } else if (!busy && !synced && !localSaved && choices.size) {
    if (confirm('本机决定尚未持久保存。取消后可先导出；继续离开将放弃仅在内存中的决定。仍要离开吗？')) return;
  } else if (!busy && pendingDecision && pendingRetained && retainPendingDecision()) {
    if (confirm('原请求已保留在本标签页的会话存储中，结果仍需核对。返回审核页或重新登录后可恢复同一请求，不会自动重发。仍要离开吗？')) return;
  } else if (!busy && pendingDecision?.outcome === 'new') {
    if (confirm('本次请求尚未发送，也未能可靠保存在本机。继续离开将放弃这份未提交草稿。仍要离开吗？')) return;
  } else if (!busy && !pendingDecision) return;
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
  if (!keys(value,['schema','scope','pending']) || value.schema!==1 || value.scope!==scope || !keys(pending,['id','decision','checklistRevision','scope','command','outcome']) || pending.scope!==scope || !['new','unknown','rejected','confirmed'].includes(pending.outcome) || !keys(command,['url','method','body','key']) || ![REVIEW_API,REVIEW_API+'/notes'].includes(command.url) || !['PATCH','POST'].includes(command.method) || typeof command.body!=='string' || command.body.length>131072 || typeof command.key!=='string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/.test(command.key)) throw Error('本机恢复请求无效。');
  const body = JSON.parse(command.body);
  if (command.url===REVIEW_API+'/notes') {
    if (command.method!=='PATCH' || !keys(body,['expectedRevision','checklistRevision','id','note']) || !Number.isSafeInteger(body.expectedRevision) || body.expectedRevision<1 || typeof body.id!=='string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(body.id) || typeof body.checklistRevision!=='string' || !body.checklistRevision.trim() || body.checklistRevision.length>128 || typeof body.note!=='string' || body.note.includes('\0') || body.note.length>8000 || pending.id!==body.id || pending.decision!==null || pending.checklistRevision!==body.checklistRevision) throw Error('本机备注恢复请求无效。');
  } else if (command.method==='PATCH') {
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
  if (pendingDecision?.command.url===REVIEW_API+'/notes' && pendingDecision.outcome==='confirmed') clearNoteDraft(pendingDecision);
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
  let notes;
  if (OWN(value,'notes')) {
    if (!Array.isArray(value.notes) || value.notes.length>checklist.items.length) throw Error('LifeOS 返回的备注无效。');
    const seen = new Set();
    notes = value.notes.map(n=>{
      if (!n || Object.keys(n).sort().join(',')!=='id,note' || !checklist.items.some(i=>i.id===n.id) || seen.has(n.id) || typeof n.note!=='string' || n.note==='' || n.note.includes('\0') || n.note.length>8000) throw Error('LifeOS 返回的备注无效。');
      seen.add(n.id); return {id:n.id,note:n.note};
    });
  }
  return {revision:value.revision,checklist,decisions:[...decisions].map(([id,decision])=>({id,decision})),...(notes!==undefined?{notes}:{})};
}
function freezeReviewCommand(method,body,url=REVIEW_API) {
  return Object.freeze({url,method,body:JSON.stringify(body),key:crypto.randomUUID()});
}
function decisionMatches(snapshot,pending) {
  const original = JSON.parse(pending.command.body);
  if (pending.command.url===REVIEW_API+'/notes') return snapshot && snapshot.revision>=original.expectedRevision && snapshot.checklist.revision===pending.checklistRevision && snapshot.checklist.items.some(i=>i.id===pending.id) && (snapshot.notes?.find(n=>n.id===pending.id)?.note ?? '')===original.note;
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
  byId('export').disabled = !choices.size && !remote?.notes?.length && !noteDrafts.size;
  byId('open-server').disabled = busy;
  byId('save-server').disabled = busy || synced || uncertain || !!pendingDecision || remote === undefined || !review.items.length;
  byId('sync-login').hidden = !sessionDenied && !pendingDecision && !uncertain;
  byId('import').disabled = busy || !!pendingDecision;
  byId('file').disabled = busy || !!pendingDecision;
  byId('sync-state').textContent = (synced ? ({saving:'LifeOS 清单 · 正在保存并读回',saved:'LifeOS 已保存清单',error:'LifeOS 清单 · 保存未确认'}[syncStatus]) : '本机预览') + (uncertain ? ' · 请先重新读回' : '');
  byId('sync-state').parentElement.dataset.sync = syncStatus;
  const pending = pendingDecision;
  const notePending = pending?.command.url===REVIEW_API+'/notes';
  byId('pending-input').hidden = !pending || sessionDenied;
  if (pending && !sessionDenied) {
    const latest = choices.get(pending.id);
    byId('pending-description').textContent = pending.command.method==='POST' ? '本次清单保存尚未确认。' : notePending ? pending.id+'：本次备注「'+JSON.parse(pending.command.body).note+'」尚未确认。服务器原文：「'+(remote?.notes?.find(n=>n.id===pending.id)?.note ?? '')+'」。' : pending.id + '：本次输入「' + (pending.decision === null ? '撤销决定' : DECISIONS[pending.decision]) + '」尚未确认。服务器当前为「' + (latest ? DECISIONS[latest] : '尚未决定') + '」。';
    byId('pending-description').textContent += pendingRetained ? ' 原请求已保留在本标签页的会话存储；可确认后返回或重新登录，回来后显式恢复同一请求。' : ' 原请求未能可靠保存在本机；请保留当前页面。';
    if (pending.outcome==='new') byId('pending-description').textContent += busy ? ' 正在提交并核对原请求。' : ' 尚未发送；这是未提交草稿。';
    byId('pending-description').textContent += pending.outcome === 'rejected' ? ' 原请求已明确拒绝，可按最新版本重新确认。' : pending.outcome === 'confirmed' ? ' 原请求已收到确认，读回后不会重复写入。' : pending.outcome === 'new' ? ' 继续时只使用已保留的原请求。' : ' 原请求结果未知，重试只会恢复原请求，不会覆盖为新的决定。';
    byId('retry-decision').textContent = pending.outcome === 'rejected' ? '按最新版本重新确认' : pending.outcome === 'confirmed' ? '确认原请求结果' : '按原请求重试确认';
    byId('retry-decision').disabled = busy || uncertain || recoveryBlocked || (pending.command.method==='POST' ? remote===undefined : !remote || review.revision !== pending.checklistRevision || !review.items.some(item=>item.id===pending.id && (notePending || item.status==='pending')));
    byId('discard-decision').disabled = busy;
    byId('discard-decision').textContent = ['new','rejected'].includes(pending.outcome) ? '放弃本次输入' : '保留原请求，稍后核对';
  }
  for (const input of byId('list').querySelectorAll('.choices input,.choices button')) input.disabled = !canEdit() || !!pendingDecision;
  for (const input of byId('list').querySelectorAll('.row-note textarea,.row-note button')) input.disabled = !synced || !reviewScope || !canEdit() || !!pendingDecision;
  const missingDrafts = [...noteDrafts.keys()].filter(id=>!review.items.some(i=>i.id===id));
  byId('note-draft-state').textContent = noteDrafts.size ? noteDrafts.size+' 份本机备注草稿，尚未保存到 LifeOS。'+(noteDraftsReliable ? '' : ' 本机保留失败，请勿关闭页面。')+(missingDrafts.length ? ' 不在当前清单：'+missingDrafts.join('、')+'；草稿仍保留。' : '') : '';
}
const isSessionDenial = error => error?.status === 401 || error?.status === 403;
function hideDeniedServerReview(status) {
  if (host) {
    clearPrivateState();
    sessionDenied = true;
    conceal(status===401 ? '登录已失效。请重新登录后核对。' : '当前会话无权读取存储审核。',status===401);
    return;
  }
  reviewGeneration++;
  reviewScope = null;
  remote = undefined;
  uncertain = !!pendingDecision && !['new','rejected'].includes(pendingDecision.outcome);
  sessionDenied = true;
  noteDrafts = new Map(); noteDraftScope = null; noteDraftsReliable = true; noteDraftCorrupt = false;
  byId('pending-description').textContent = '';
  if (synced) {
    const dialog = byId('copy-dialog');
    if (dialog.open) dialog.close();
    byId('copy-text').value = '';
    useReview(parseReview({schema:1,revision:'empty',items:[]}));
  }
  announce(status === 401
    ? '登录已失效。请重新登录 LifeOS 后读取清单。仍可审核和导出本机清单。'
    : '当前会话无权读取 LifeOS 清单。仍可审核和导出本机清单。');
}
async function openServer(automatic=false,verifiedScope) {
  if (busy) return;
  if (!automatic && !synced && choices.size && !confirm(localSaved ? '切换到 LifeOS 清单？本机决定仍保存在原清单版本。' : '本机决定尚未持久保存。可先取消并导出。仍切换到 LifeOS 清单吗？')) return;
  busy = true;
  const generation = ++reviewGeneration;
  syncControls();
  try {
    const scope = verifiedScope ?? await readReviewScope();
    if (generation!==reviewGeneration) return;
    loadNoteDrafts(scope);
    if (scope!==reviewScope) {
      if (reviewScope && synced) useReview(parseReview({schema:1,revision:'empty',items:[]}));
      reviewScope = scope;
      pendingDecision = null;
      pendingRetained = false;
      try { restorePendingDecision(); recoveryBlocked=noteDraftCorrupt; } catch { recoveryBlocked=true; }
    }
    const fresh = await requestReview();
    if (generation!==reviewGeneration) return;
    remote = fresh;
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
    if (generation!==reviewGeneration) return;
    if (isSessionDenial(error)) hideDeniedServerReview(error.status);
    else announce('暂时无法读取 LifeOS。可导入本机清单，稍后再读回。');
  } finally {
    if (generation===reviewGeneration || sessionDenied) { busy = false; syncControls(); }
  }
}
async function writeServer(method,body,match,command) {
  busy = true;
  syncStatus = 'saving';
  syncControls();
  announce('正在保存并读回 LifeOS…');
  let failure;
  const generation = typeof reviewGeneration === 'number' ? reviewGeneration : undefined;
  const pending = pendingDecision;
  const priorUnknown = pending?.outcome === 'unknown';
  try {
    const receipt = await requestReview(method,body,command);
    if (generation!==undefined && generation!==reviewGeneration) return;
    if (pending) { pending.outcome = match(receipt) ? 'confirmed' : 'unknown'; retainPendingDecision(); }
  } catch (error) {
    if (generation!==undefined && generation!==reviewGeneration) return;
    failure = error;
    if (pending) { pending.outcome = !priorUnknown && error?.status === 409 ? 'rejected' : 'unknown'; retainPendingDecision(); }
  }
  try {
    const fresh = await requestReview();
    if (generation!==undefined && generation!==reviewGeneration) return;
    remote = fresh;
    uncertain = false;
    sessionDenied = false;
    const agrees = fresh && match(fresh);
    const confirmed = pending?.outcome === 'confirmed';
    syncStatus = agrees || confirmed ? 'saved' : 'error';
    if (agrees || confirmed) { if (pending) pending.outcome='confirmed'; clearPendingDecision(); }
    if (fresh && (synced || agrees)) useReview(fresh.checklist,fresh,false);
    if (agrees) {
      announce(failure ? '已读回 LifeOS 上的决定与清单。' : method === 'POST' ? '清单已保存到 LifeOS，并已读回。' : pending?.command.url===REVIEW_API+'/notes' ? '备注已保存，并已读回 LifeOS。' : '决定已保存，并已读回 LifeOS。');
    } else if (confirmed) {
      announce('原请求已确认；最新服务器决定已有变化，已显示最新状态。可另行选择新的决定。');
    } else if (failure?.status === 403) {
      announce('当前会话无权保存到 LifeOS。已读回清单，请核对待确认的输入。');
    } else if (pending?.outcome === 'rejected' || !pending && failure?.status === 409) {
      announce('LifeOS 清单已变化，已读回最新状态。请核对后重试。');
    } else {
      announce('已读回 LifeOS，但未确认本次保存。请核对后重试。');
    }
  } catch (error) {
    if (generation!==undefined && generation!==reviewGeneration) return;
    syncStatus = 'error';
    if (isSessionDenial(error)) hideDeniedServerReview(error.status);
    else if (isSessionDenial(failure)) hideDeniedServerReview(failure.status);
    else {
      uncertain = true;
      announce('尚未确认保存结果。请先打开 LifeOS 清单读回，再继续。');
    }
  } finally {
    if (generation===undefined || generation===reviewGeneration || sessionDenied) { busy = false; syncControls(); }
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
async function saveNote(item,note) {
  if (!synced || !canEdit() || pendingDecision || !reviewScope || !review.items.some(i=>i.id===item.id)) return;
  const draft = noteDrafts.get(item.id);
  if (!draft || draft.checklistRevision!==review.revision) { announce('备注草稿所属清单已变化，原草稿仍保留；请先核对原条目，不能直接保存到新清单。'); return; }
  if (!retainNoteDrafts()) { announce('备注草稿未能在本机保留，尚未发送。请保留当前页面。'); return; }
  const body = {expectedRevision:draft.expectedRevision,checklistRevision:review.revision,id:item.id,note};
  const pending = {id:item.id,decision:null,checklistRevision:review.revision,scope:reviewScope,command:freezeReviewCommand('PATCH',body,REVIEW_API+'/notes'),outcome:'new'};
  pendingDecision = pending;
  if (!retainPendingDecision()) { render(); announce('原备注请求无法在本机保留，尚未发送。'); return; }
  await writeServer('PATCH',body,snapshot=>decisionMatches(snapshot,pending),pending.command);
}
function noteEditor(item,index) {
  const section = make('section','row-note'),label = make('label','','备注与处理要求');
  const input = make('textarea'); input.id='item-note-'+index; input.maxLength=8000; input.rows=3; label.htmlFor=input.id;
  const saved = synced ? remote?.notes?.find(n=>n.id===item.id)?.note ?? '' : '';
  const draft = noteDraftScope===reviewScope ? noteDrafts.get(item.id) : null;
  input.value = draft ? draft.note : saved;
  const status = make('span','note-status',!synced ? '保存清单到 LifeOS 后可填写备注' : draft ? '未保存草稿'+(draft.checklistRevision!==review.revision ? ' · 原清单已变化，请核对' : '') : saved ? '已保存' : '尚无备注');
  const actions = make('div','note-actions'),save = make('button','','保存备注'),clear = make('button','','清空并保存');
  save.type=clear.type='button';
  input.addEventListener('input',()=>{ const kept=updateNoteDraft(item.id,input.value); status.textContent=kept ? '未保存草稿 · 已在本标签页保留' : '未保存草稿 · 本机保留失败，请勿关闭页面'; syncControls(); });
  save.addEventListener('click',()=>void saveNote(item,input.value));
  clear.addEventListener('click',()=>{input.value='';updateNoteDraft(item.id,'');void saveNote(item,'');});
  actions.append(save,clear,status); section.append(label,input,actions); return section;
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
  byId('copy').disabled = !choices.size;
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
    const emptyText = sessionDenied ? '可导入本机清单继续审核。' :
      review.items.length ? '没有符合条件的资料。试试修改关键词或筛选。' : '清单为空。请选择「导入清单」。';
    parent.append(make('p','empty',emptyText));
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
      content.append(noteEditor(item,index));
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
for (const link of root.querySelectorAll('.return-nav a,#sync-login,#storage-relogin')) { link.addEventListener('click',guardNoteNavigation,ownEvent); link.addEventListener('click',guardReviewNavigation,ownEvent); }
function beforeUnload(event) { if (noteDrafts.size && !noteDraftsReliable || pendingDecision && !pendingRetained) { event.preventDefault(); event.returnValue=''; } }
window.addEventListener('beforeunload',beforeUnload);
byId('search').addEventListener('input',render,ownEvent);
byId('filter').addEventListener('change',render,ownEvent);
byId('group-filter').addEventListener('change',render,ownEvent);
byId('discard-decision').addEventListener('click',()=>{
  if (busy) return;
  if (pendingDecision && !['new','rejected'].includes(pendingDecision.outcome)) {
    retainPendingDecision(); render(); announce(pendingRetained ? '原请求已保留，保存结果仍未知。可确认后返回或重新登录，稍后恢复同一请求。' : '原请求结果仍未知，未能可靠保留。请保留当前页面，恢复会话存储后再离开。'); return;
  }
  clearPendingDecision(); syncStatus = uncertain ? 'error' : 'saved'; render(); announce('已放弃未提交或已明确拒绝的输入，当前显示最近读回的服务器决定。');
},ownEvent);
async function retryDecision() {
  if (!pendingDecision || !canEdit() || pendingDecision.command.method!=='POST' && review.revision !== pendingDecision.checklistRevision) return;
  const pending = pendingDecision;
  const item = review.items.find(item=>item.id===pending.id && (pending.command.url===REVIEW_API+'/notes' || item.status==='pending'));
  if (pending.command.method!=='POST' && !item) return;
  if (decisionMatches(remote,pending) || pending.outcome === 'confirmed') {
    pending.outcome = 'confirmed';
    clearPendingDecision(); syncStatus = 'saved'; render();
    announce(decisionMatches(remote,pending) ? '读回的决定已与本次输入一致。' : '原请求已确认；最新服务器决定已有变化，已显示最新状态。可另行选择新的决定。');
    return;
  }
  if (pending.outcome === 'rejected') {
    clearPendingDecision();
    if (pending.command.method==='POST') { announce('清单请求已明确拒绝。请核对最新清单，重新导入并确认保存。'); render(); }
    else if (pending.command.url===REVIEW_API+'/notes') { const note=JSON.parse(pending.command.body).note;updateNoteDraft(item.id,note,true);await saveNote(item,note); }
    else await choose(item,pending.decision);
  } else {
    if (!retainPendingDecision()) { render(); announce('原请求无法在本机保留，尚未继续发送。请保留当前页面。'); return; }
    await writeServer(pending.command.method,JSON.parse(pending.command.body),snapshot=>decisionMatches(snapshot,pending),pending.command);
  }
}
byId('retry-decision').addEventListener('click',()=>{
  void retryDecision();
},ownEvent);
byId('compact').addEventListener('click',()=>{
  compact = !compact;
  byId('compact').setAttribute('aria-pressed',String(compact));
  byId('compact').textContent = compact ? '展开视图' : '精简视图';
  render();
},ownEvent);
byId('import').addEventListener('click',()=>byId('file').click(),ownEvent);
byId('open-server').addEventListener('click',()=>void openServer(),ownEvent);
byId('save-server').addEventListener('click',()=>void savePreview(),ownEvent);
byId('file').addEventListener('change',async()=>{
  const generation = reviewGeneration;
  const file = byId('file').files[0];
  byId('file').value = '';
  if (!file || busy) return;
  if (!synced && choices.size && !localSaved && !confirm('本机决定尚未持久保存。可先取消并导出。仍打开另一份清单吗？')) return;
  try {
    if (file.size > MAX_IMPORT_BYTES) throw Error('清单超过 2 MiB。');
    const text = new TextDecoder('utf-8',{fatal:true}).decode(await file.arrayBuffer());
    if (busy || controller.signal.aborted || generation!==reviewGeneration || host && byId('storage-review-body').hidden) return;
    useReview(/\.csv$/i.test(file.name) ? parseCsvReview(text) : parseReview(JSON.parse(text)));
  }
  catch(error) { announce(error instanceof SyntaxError ? '无法读取 JSON，请检查文件格式。' : error.message); }
},ownEvent);
byId('copy').addEventListener('click',async()=>{
  const generation = reviewGeneration;
  const text = serialize(review,choices).choices.map(i=>i.id+'\t'+DECISIONS[i.decision]).join('\n');
  try {
    await navigator.clipboard.writeText(text);
    announce('已复制编号和决定。');
  } catch {
    if (controller.signal.aborted || generation!==reviewGeneration || host && byId('storage-review-body').hidden) return;
    byId('copy-text').value = text;
    byId('copy-dialog').showModal();
    byId('copy-text').select();
  }
},ownEvent);
byId('close-copy').addEventListener('click',()=>byId('copy-dialog').close(),ownEvent);
byId('export').addEventListener('click',()=>{
  const data = JSON.stringify({...serialize(review,choices),notes:synced ? remote?.notes??[] : [],noteDrafts:noteDraftScope===reviewScope ? [...noteDrafts].map(([id,draft])=>({id,...draft})) : []},null,2)+'\n';
  const url = URL.createObjectURL(new Blob([data],{type:'application/json'}));
  const link = make('a');
  link.href = url;
  link.download = '存储审核决定.json';
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
  announce('已生成决定 JSON。');
},ownEvent);
function mayLeave() {
  let allowed = true;
  const event = {preventDefault(){allowed=false;}};
  guardNoteNavigation(event);
  if (allowed) guardReviewNavigation(event);
  return allowed;
}
const embedded = byId('review-data')?.textContent.trim() ?? '';
try {
  useReview(parseReview(embedded.startsWith('{') ? JSON.parse(embedded) : {schema:1,revision:'empty',items:[]}));
} catch (error) {
  useReview(parseReview({schema:1,revision:'empty',items:[]}));
  announce(error.message);
}

function conceal(message,login=false) {
  const body = byId('storage-review-body');
  if (body) { body.hidden = true; body.inert = true; }
  const verification = byId('storage-verification');
  verification.hidden = false;
  byId('storage-verification-message').textContent = message;
  byId('storage-relogin').hidden = !login;
  const dialog = byId('copy-dialog');
  if (dialog.open) dialog.close();
  byId('copy-text').value = '';
}
function clearPrivateState() {
  reviewGeneration++;
  reviewScope = noteDraftScope = null;
  pendingDecision = null; pendingRetained = false; recoveryBlocked = false;
  noteDrafts.clear(); noteDraftsReliable = true; noteDraftCorrupt = false;
  remote = undefined; uncertain = false; sessionDenied = false;
  collapsedBranches.clear();
  compact = false;
  byId('compact').setAttribute('aria-pressed','false');
  byId('compact').textContent = '精简视图';
  byId('pending-description').textContent = '';
  byId('file').value = '';
  syncStatus = 'saved';
  useReview(parseReview({schema:1,revision:'empty',items:[]}));
}
let verification = 0, verifying = false;
async function verifyWorkspace() {
  if (document.visibilityState==='hidden' || controller.signal.aborted || verifying) return;
  verifying = true;
  const token = ++verification;
  const previousScope = reviewScope;
  const previousFocus = byId('storage-review-body').contains(document.activeElement) ? document.activeElement : null;
  conceal('正在核对本人空间…');
  const button = byId('storage-verify');
  button.disabled = true;
  try {
    const scope = await readReviewScope();
    if (token!==verification || controller.signal.aborted) return;
    if (reviewScope && scope!==reviewScope) {
      clearPrivateState();
      busy = false;
    }
    if (!reviewScope || remote===undefined) {
      await openServer(true,scope);
      if (token!==verification || controller.signal.aborted) return;
      if (reviewScope!==scope || remote===undefined) throw Error('Unverified review');
    }
    const body = byId('storage-review-body');
    byId('storage-verification').hidden = true;
    body.hidden = body.inert = false;
    if (scope===previousScope && previousFocus?.isConnected) previousFocus.focus({preventScroll:true});
  } catch (error) {
    if (token!==verification || controller.signal.aborted) return;
    if (isSessionDenial(error)) clearPrivateState();
    conceal(error?.status===401 ? '登录已失效。请重新登录后核对。' : '暂时无法核对本人空间。清单已隐藏。',error?.status===401);
  } finally {
    verifying = false;
    if (token===verification && !controller.signal.aborted) button.disabled = false;
    if (token!==verification && document.visibilityState==='visible') void verifyWorkspace();
  }
}
function background() {
  verification++;
  conceal('正在核对本人空间…');
}
function visibility() {
  if (document.visibilityState==='hidden') background();
  else void verifyWorkspace();
}
function mountInWorkspace() {
  const options={signal:controller.signal};
  byId('storage-verify').addEventListener('click',()=>void verifyWorkspace(),options);
  document.addEventListener('visibilitychange',visibility,options);
  window.addEventListener('focus',()=>void verifyWorkspace(),options);
  window.addEventListener('pagehide',background,options);
  window.addEventListener('pageshow',()=>void verifyWorkspace(),options);
  void verifyWorkspace();
}
if (host) mountInWorkspace();
else void openServer(true);
return {
  mayLeave,
  dispose(){
    controller.abort();
    window.removeEventListener('beforeunload',beforeUnload);
    if (host) {
      background();
      clearPrivateState();
    }
  },
};
}
