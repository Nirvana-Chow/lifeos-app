import {normalizePersonalFields} from './business.ts';
import type {RecordFields,RecordModule} from './record-model.ts';
import {emptyPersonPersonal} from '../personal-people/model.ts';
import {emptyHealthFields} from '../personal-health/presentation.ts';
import {emptyMediaPersonal,mediaStates} from '../personal-media/domain.ts';
import {emptyCareerPersonal,applicationStates,type CareerKind,type ApplicationState} from '../personal-career/domain.ts';
import {emptyPortfolioPersonal,type PortfolioKind} from '../personal-portfolio/model.ts';

export const recordModuleLabels={journal:'日记',health:'健康',person:'人物',media:'书影音',career:'职业与简历',portfolio:'账户资产投资'};
export const recordModuleDescriptions={journal:'记录当天，也可以关联项目、领域和人物。',person:'只填写你知道的资料，生日可以只记月日。',health:'记录身体、睡眠和训练；未知数值可留空。',media:'记录想读、在读和看过的作品，保留自己的进度与感想。',career:'保存教育、工作与成果，整理简历版本和求职进展。',portfolio:'分别记录账户余额、资产估值与投资持仓。'};
export type RecordView='table'|'trend'|'training'|'board'|'resume'|'overview';
export const initialRecordView=(type:RecordModule):RecordView=>type==='media'?'board':type==='portfolio'?'overview':'table';
export function recordModuleEnabled(type:RecordModule,status:{storageVerified?:boolean;allowedTypes?:readonly string[];healthEnabled?:boolean;peopleEnabled?:boolean;mediaEnabled?:boolean;careerEnabled?:boolean;portfolioEnabled?:boolean}):boolean{
 if(status.storageVerified!==true)return false;
 return type==='journal'?status.allowedTypes?.includes('journal')===true:type==='person'?status.peopleEnabled===true:type==='health'?status.healthEnabled===true:type==='media'?status.mediaEnabled===true:type==='career'?status.careerEnabled===true:status.portfolioEnabled===true;
}
export function emptyRecordFields(type:RecordModule,timeZone:string,kind?:CareerKind|PortfolioKind):RecordFields{
 if(type==='health')return emptyHealthFields('body',timeZone);
 const personal=type==='person'?emptyPersonPersonal():type==='media'?emptyMediaPersonal():type==='career'?emptyCareerPersonal(kind as CareerKind|undefined):type==='portfolio'?emptyPortfolioPersonal((kind??'account') as PortfolioKind):{type:'journal' as const,links:{project:null,domain:null,topics:[],people:[]}};
 return{title:'',text:'',occurredOn:null,personal};
}
/** State controls retain the full current record and use the normal revision-checked writer. */
export function recordStageFields(type:RecordModule,fields:RecordFields,state:string):RecordFields{
 const p=fields.personal;
 if(type==='media'&&p?.type==='media'&&mediaStates.includes(state as typeof mediaStates[number]))return normalizePersonalFields(type,{...fields,personal:{...p,state}}) as RecordFields;
 if(type==='career'&&p?.type==='career'&&p.careerKind==='opportunity'&&applicationStates.includes(state as ApplicationState))return normalizePersonalFields(type,{...fields,personal:{...p,applicationState:state}}) as RecordFields;
 throw Error('此记录不支持该状态，请刷新后重试。');
}
