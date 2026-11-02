import {readAppleOrigin} from './apple-origin';
export function AppleSourceNotice({original,spaceId}:{original:unknown;spaceId:string}){
 let source;try{source=readAppleOrigin(original,spaceId);}catch{return null;}
 const times=source.source.sourceTimes;
 return <section aria-label="Apple 来源与编辑边界"><h3>来源：Apple 提醒事项</h3><p>读取截至 {source.source.capturedAt}。原始状态：{source.source.isCompleted?'已完成':'未完成'}。{times.lastModifiedDate&&<> 来源更新时间：{times.lastModifiedDate}。</>}</p><p>这是导入后的站内副本。本页更正与完成只保存在 LifeOS，不会反写 Apple；来源变化会提示冲突。</p>{!source.source.notesIncluded&&<p>本批未导入来源备注。</p>}<details><summary>来源标识</summary><p>{source.sourceRef}</p></details></section>;
}
