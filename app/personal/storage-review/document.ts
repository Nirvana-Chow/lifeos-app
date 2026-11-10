// Static review interface. Real review files are imported locally by the browser.
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
*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);line-height:1.55}.wrap{width:min(1080px,calc(100% - 48px));margin:auto}.mast{background:var(--navy);color:#fff;padding:40px 0 34px;border-bottom:6px solid #8ba8f7}.mast .wrap{display:grid;grid-template-columns:1fr minmax(230px,310px);gap:32px;align-items:end}.eyebrow{margin:0 0 5px;font-size:.85rem;color:#c9d8fa}.mast h1{font-size:clamp(2rem,5vw,3.2rem);letter-spacing:-.05em;line-height:1.08;margin:0 0 12px}.mast p{margin:0;max-width:55ch}.mast .summary{margin-top:10px;color:#dce6fc;white-space:pre-wrap;overflow-wrap:anywhere}.progress-box{padding:14px 17px;border:1px solid #6c83b2;border-radius:9px}.progress-box strong{font-size:1.3rem;font-variant-numeric:tabular-nums}.progress-box span{display:block;color:#dce6fc;font-size:.86rem}progress{display:block;width:100%;margin-top:8px;accent-color:#9ab5ff;height:9px}.controls{display:flex;flex-wrap:wrap;gap:10px;align-items:end;padding:18px 0 12px}.search{flex:1 1 230px}.filter{flex:0 1 166px}.controls label{display:block;color:var(--muted);font-size:.83rem;margin-bottom:4px}.controls input,.controls select,button{font:inherit;color:inherit;border:1px solid var(--line);border-radius:7px;background:var(--surface);min-height:44px;padding:7px 12px}.controls input,.controls select{width:100%}button{cursor:pointer}button:hover{border-color:var(--accent);color:var(--accent)}button:disabled{cursor:default;opacity:.6}button:focus-visible,input:focus-visible,select:focus-visible,summary:focus-visible{outline:3px solid #3d6ee4;outline-offset:3px}.actions{display:flex;gap:7px;flex-wrap:wrap}.primary{background:var(--accent);color:#fff;border-color:var(--accent)}.primary:hover{background:#173d9c;color:#fff}.meta{display:flex;flex-wrap:wrap;justify-content:space-between;gap:6px 16px;border-bottom:1px solid var(--line);padding-bottom:11px;color:var(--muted);font-size:.88rem}.note{min-height:1.6rem;margin:10px 0;color:var(--muted);font-size:.9rem}.group{margin:0 0 24px}.group h2{font-size:1rem;margin:0 0 7px;color:var(--navy);overflow-wrap:anywhere}.rows{background:var(--surface);border:1px solid var(--line);border-radius:10px;overflow:hidden}.row{display:grid;grid-template-columns:40px minmax(0,1fr) auto;gap:12px;padding:15px 16px;align-items:start;border-left:4px solid transparent}.row+.row{border-top:1px solid var(--line)}.row[data-decision=keep]{border-left-color:#28795c}.row[data-decision=trash]{border-left-color:#b55742}.row[data-decision=defer]{border-left-color:#a4771d}.row[data-status=protected],.row[data-status=processed]{background:#f8fafd}.icon{display:grid;place-items:center;height:36px;width:36px;border-radius:8px;color:var(--navy);background:#e9effb}.icon svg{width:21px;height:21px;fill:none;stroke:currentColor;stroke-width:1.6;stroke-linecap:round;stroke-linejoin:round}.rowhead{display:flex;flex-wrap:wrap;align-items:baseline;gap:4px 8px;margin:0 0 4px}.id{color:var(--accent);font-size:.82rem;font-weight:700}.row h3{font-size:1rem;line-height:1.42;margin:0;overflow-wrap:anywhere}.status{font-size:.76rem;color:var(--muted);border:1px solid var(--line);border-radius:99px;padding:1px 7px;white-space:nowrap}.body,.question{overflow-wrap:anywhere;white-space:pre-wrap;margin:6px 0 0;color:var(--muted);font-size:.9rem}.question{color:var(--ink)}details{margin-top:5px}summary{cursor:pointer;color:var(--accent);font-size:.85rem;min-height:30px;align-content:center}.choices{display:flex;flex-wrap:wrap;gap:5px;min-width:0}.choices label{position:relative;cursor:pointer}.choices input{position:absolute;opacity:0;width:1px;height:1px}.choices span{display:grid;place-items:center;padding:6px 9px;min-height:38px;background:#fff;border:1px solid var(--line);border-radius:6px;font-size:.84rem;white-space:nowrap}.choices input:focus-visible+span{outline:3px solid #3d6ee4;outline-offset:2px}.choices input[value=keep]:checked+span{color:var(--keep);background:var(--keep-bg);border-color:var(--keep);font-weight:700}.choices input[value=trash]:checked+span{color:var(--trash);background:var(--trash-bg);border-color:var(--trash);font-weight:700}.choices input[value=defer]:checked+span{color:var(--defer);background:var(--defer-bg);border-color:var(--defer);font-weight:700}.empty{padding:30px 18px;background:#fff;border:1px dashed var(--line);border-radius:8px;color:var(--muted)}footer{padding:6px 0 32px;color:var(--muted);font-size:.85rem;overflow-wrap:anywhere}dialog{width:min(550px,calc(100% - 32px));border:1px solid var(--line);border-radius:10px;padding:20px;color:var(--ink);background:var(--surface)}dialog::backdrop{background:#192c5088}dialog textarea{display:block;width:100%;min-height:180px;margin:12px 0;border:1px solid var(--line);font:inherit;padding:8px}
@media(max-width:720px){.wrap{width:calc(100% - 28px)}.mast{padding:26px 0 22px}.mast .wrap{grid-template-columns:1fr;gap:15px}.controls{gap:8px}.search{flex-basis:52%}.filter{flex:1 1 110px}.actions{width:100%}.row{grid-template-columns:32px minmax(0,1fr);padding:12px 10px;gap:8px}.icon{width:30px;height:30px}.choices{grid-column:2}.choices span{min-height:44px}.row h3{font-size:.96rem}}
@media(max-width:370px){.actions button{padding-inline:8px}.choices span{padding-inline:6px}.row{grid-template-columns:26px minmax(0,1fr)}.icon{width:26px;height:26px}}
</style>
</head>
<body>
<header class="mast"><div class="wrap"><div><p class="eyebrow">资料去留清单</p><h1>存储审核</h1><p>按编号记录要保留、移入废纸篓或暂缓的资料。</p><p class="summary" id="summary" hidden></p></div><section class="progress-box" aria-label="审核进度"><strong id="progress-text">0 / 0</strong><span id="progress-caption">已记录决定</span><progress id="progress" value="0" max="1" aria-label="已记录决定的进度"></progress></section></div></header>
<main class="wrap">
<div class="controls" aria-label="清单工具">
<div class="search"><label for="search">搜索资料</label><input id="search" type="search" placeholder="输入编号、名称或关键词" autocomplete="off"></div>
<div class="filter"><label for="filter">筛选</label><select id="filter"><option value="all">全部资料</option><option value="pending">尚未决定</option><option value="keep">留</option><option value="trash">移废纸篓</option><option value="defer">待定</option><option value="processed">已处理／受保护</option></select></div>
<div class="actions"><button type="button" id="compact" aria-pressed="false">精简视图</button><button type="button" id="import">导入清单</button><button type="button" id="copy" disabled>复制编号</button><button type="button" class="primary" id="export" disabled>导出决定</button></div>
<input type="file" id="file" accept=".csv,.json,text/csv,application/json" hidden>
</div>
<div class="meta"><span id="visible"></span><span id="counts"></span></div>
<p class="note" id="notice" role="status" aria-live="polite"></p>
<div id="list"></div>
<footer><span id="revision"></span><br>选项只记录决定。请导出 JSON 留存审核结果。</footer>
</main>
<dialog id="copy-dialog" aria-labelledby="copy-title"><h2 id="copy-title">复制审核决定</h2><label for="copy-text">选中并复制以下编号</label><textarea id="copy-text" readonly></textarea><button type="button" id="close-copy">关闭</button></dialog>
<script type="application/json" id="review-data">{"schema":1,"revision":"empty","items":[]}</script>
<script>
'use strict';
const DECISIONS = Object.freeze({keep:'留',trash:'移废纸篓',defer:'待定'});
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
function matches(item,query,filter,choices) {
  const decision = choices.get(item.id);
  const statusMatch = filter === 'all' || (filter === 'pending' && item.status === 'pending' && !decision) || (filter === 'processed' && item.status !== 'pending') || (OWN(DECISIONS,filter) && item.status === 'pending' && decision === filter);
  return statusMatch && (!query || [item.id,item.title,item.group,item.body,item.question,KINDS[item.kind]].some(v=>v.toLowerCase().includes(query)));
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
let review, choices = new Map(), compact = false;
function announce(text) { byId('notice').textContent = text; }
function useReview(next) {
  review = next;
  choices = new Map();
  let raw = null;
  try {
    raw = localStorage.getItem(storageKey(review.revision));
    choices = readChoices(raw,review);
    announce(review.items.length ? '决定保存在当前浏览器。' : '导入审核清单 CSV 或 JSON 后即可开始。');
  } catch {
    if (raw !== null) {
      try { localStorage.removeItem(storageKey(review.revision)); } catch {}
      announce('原保存记录已损坏，已从空白决定开始。');
    } else {
      announce('当前浏览器无法保存决定，请及时导出。');
    }
  }
  byId('summary').textContent = review.context.summary;
  byId('summary').hidden = !review.context.summary;
  byId('revision').textContent = '清单版本 ' + review.revision;
  byId('search').value = '';
  byId('filter').value = 'all';
  render();
}
function store() {
  try {
    localStorage.setItem(storageKey(review.revision),JSON.stringify(serialize(review,choices)));
    announce('决定已保存。');
  } catch {
    announce('当前浏览器无法保存决定，请先导出。');
  }
}
function metrics(shown) {
  const total = review.items.filter(i=>i.status==='pending').length;
  const n = {keep:0,trash:0,defer:0};
  for (const v of choices.values()) n[v]++;
  byId('progress-text').textContent = choices.size + ' / ' + total;
  byId('progress').max = total || 1;
  byId('progress').value = choices.size;
  byId('counts').textContent = '留 '+n.keep+' · 移废纸篓 '+n.trash+' · 待定 '+n.defer;
  byId('visible').textContent = '显示 '+shown+' / '+review.items.length+' 项';
  byId('copy').disabled = byId('export').disabled = !choices.size;
}
function render() {
  const query = byId('search').value.trim().toLowerCase();
  const filter = byId('filter').value;
  const shown = review.items.filter(i=>matches(i,query,filter,choices));
  const parent = byId('list');
  parent.replaceChildren();
  metrics(shown.length);
  if (!shown.length) {
    parent.append(make('p','empty',review.items.length ? '没有符合条件的资料。试试修改关键词或筛选。' : '清单为空。请选择「导入清单」。'));
    return;
  }
  const groups = new Map();
  for (const item of shown) {
    const group = item.group || '资料清单';
    if (!groups.has(group)) groups.set(group,[]);
    groups.get(group).push(item);
  }
  let index = 0;
  for (const [name,items] of groups) {
    const section = make('section','group');
    section.append(make('h2','',name+'（'+items.length+'）'));
    const rows = make('div','rows');
    section.append(rows);
    for (const item of items) {
      const row = make('article','row');
      const decision = choices.get(item.id);
      row.dataset.status = item.status;
      if (decision) row.dataset.decision = decision;
      row.append(icon(item.kind));
      const content = make('div');
      const head = make('div','rowhead');
      const heading = make('h3','',item.title);
      heading.id = 'item-title-' + index;
      head.append(make('span','id',item.id),heading,make('span','status',KINDS[item.kind]+' · '+(decision ? DECISIONS[decision] : STATUS[item.status])));
      content.append(head);
      const information = make(compact ? 'details' : 'div');
      if (compact && (item.body || item.question)) information.append(make('summary','','查看说明'));
      if (item.body) information.append(make('p','body',item.body));
      if (item.question) information.append(make('p','question',item.question));
      if (item.body || item.question) content.append(information);
      row.append(content);
      if (item.status === 'pending') {
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
            choices.set(item.id,value);
            store();
            // Keep the focused radio in place even when a decision changes a filter.
            if (!matches(item,query,filter,choices)) {
              render();
              byId('filter').focus();
            } else {
              row.dataset.decision = value;
              head.lastElementChild.textContent = KINDS[item.kind]+' · '+label;
              metrics(shown.length);
            }
          });
        }
        row.append(buttons);
      }
      rows.append(row);
      index++;
    }
    parent.append(section);
  }
}
byId('search').addEventListener('input',render);
byId('filter').addEventListener('change',render);
byId('compact').addEventListener('click',()=>{
  compact = !compact;
  byId('compact').setAttribute('aria-pressed',String(compact));
  byId('compact').textContent = compact ? '展开视图' : '精简视图';
  render();
});
byId('import').addEventListener('click',()=>byId('file').click());
byId('file').addEventListener('change',async()=>{
  const file = byId('file').files[0];
  byId('file').value = '';
  if (!file) return;
  try {
    if (file.size > MAX_IMPORT_BYTES) throw Error('清单超过 2 MiB。');
    const text = new TextDecoder('utf-8',{fatal:true}).decode(await file.arrayBuffer());
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
</script>
</body>
</html>
`;
