// Icons are provided by lucide-react; see third-party/licenses/lucide-Feather-LICENSE.
import type {CSSProperties} from 'react';
import {LayoutGrid,ListChecks,BookOpen,Blocks,ArrowRight,Menu,X,Search,FileText,Check,ChevronRight,Star} from 'lucide-react';
export type IconName='grid'|'records'|'book'|'tools'|'arrow'|'menu'|'close'|'search'|'file'|'check'|'chevron'|'star';
const icons={grid:LayoutGrid,records:ListChecks,book:BookOpen,tools:Blocks,arrow:ArrowRight,menu:Menu,close:X,search:Search,file:FileText,check:Check,chevron:ChevronRight,star:Star};
export function Icon({name,size=20,style}:{name:IconName;size?:number;style?:CSSProperties}){const Component=icons[name];return <Component width={size} height={size} strokeWidth={1.65} aria-hidden="true" style={style}/>;}
