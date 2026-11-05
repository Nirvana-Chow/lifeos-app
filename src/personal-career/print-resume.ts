/** Print a cloned, already escaped React article in an isolated same-origin frame. */
export function printResumeArticle(article:HTMLElement,title:string):void {
 const frame=document.createElement('iframe');
 frame.title='简历打印';frame.setAttribute('aria-hidden','true');frame.dataset.careerPrintFrame='true';
 Object.assign(frame.style,{position:'fixed',left:'-10000px',top:'0',width:'794px',height:'1123px',border:'0'});
 document.body.append(frame);
 const target=frame.contentWindow,doc=frame.contentDocument;
 if(!target||!doc){frame.remove();throw Error('无法打开简历打印视图。');}
 doc.open();doc.write('<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"></head><body></body></html>');
 doc.title=title;
 const style=doc.createElement('style');style.textContent='@page{size:A4;margin:16mm}body{margin:0;color:#111;background:white;font:11pt/1.65 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;overflow-wrap:anywhere}article{display:grid;gap:18pt}header{border-bottom:1.5pt solid #111;padding-bottom:12pt}h1{font-size:22pt;margin:0}h2{font-size:14pt;margin:0}p{margin:6pt 0 0;white-space:pre-wrap}section{break-inside:avoid}ul{padding-left:18pt}small{display:block;color:#444}a{color:#111}button{display:none}';
 doc.head.append(style);doc.body.append(article.cloneNode(true));doc.close();
 const cleanup=()=>frame.remove();target.addEventListener('afterprint',cleanup,{once:true});
 // The fallback removes a frame if the browser does not dispatch afterprint after cancelling.
 const timer=window.setTimeout(cleanup,60_000);
 target.addEventListener('afterprint',()=>window.clearTimeout(timer),{once:true});
 try{target.focus();target.print();}catch(error){window.clearTimeout(timer);cleanup();throw error;}
}
