import type {PersonalType} from './config';
const categories=[['domain','领域'],['project','项目'],['topic','主题']] as const;
/** Navigation only: category creation stays in the existing personal editor. */
export function CategoryEntries({writable,allowedTypes,className}:{writable:boolean;allowedTypes?:readonly PersonalType[];className?:string}){
 if(!writable||!allowedTypes)return null;
 return <div className={className} aria-label="分类管理">{categories.filter(([type])=>allowedTypes.includes(type)).map(([type,label])=><a key={type} href={'/personal/edit?type='+type}>新建 / 管理{label}</a>)}</div>;
}
