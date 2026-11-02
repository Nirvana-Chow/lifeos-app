import type{ModuleId}from'./navigation';
export type EntryField={name:string;label:string;type?:'text'|'textarea'|'date'|'number'|'select';options?:readonly string[]};
const f=(name:string,label:string,type:EntryField['type']='text',options?:readonly string[]):EntryField=>({name,label,type,options});
export function entryFields(id:ModuleId,tab:string):EntryField[]{
 const title=f('title','标题'),body=f('body','正文','textarea'),date=f('date','日期','date'),source=f('source','来源或原文位置');
 switch(id){
  case'records':case'inbox':return[title,body,date,source,f('disposition','处理方式','select',['待审核','待处理','只是资料','无需行动'])];
  case'todos':return[title,f('notes','说明','textarea'),f('dueOn','期限','date'),f('status','状态','select',['待办','进行中','已完成','取消']),source];
  case'finance':return tab==='账户'?[f('name','账户名称'),f('accountKind','类型','select',['现金','银行卡','信用卡','其他']),f('currency','币种'),f('balance','核实余额（未知留空）','number'),f('asOf','核实日期','date')]:[f('kind','流水类型','select',['支出','收入','退款','转账','还款']),f('amount','金额','number'),date,f('from','来源账户'),f('to','目标账户'),f('category','分类'),f('original','原流水关联（退款）'),f('notes','备注','textarea')];
  case'health':return tab==='身体指标'?[date,f('weight','体重','number'),f('fat','体脂率','number'),f('waist','腰围','number'),source]:tab==='饮食'?[date,f('meal','餐次','select',['早餐','午餐','晚餐','加餐']),f('food','食物'),f('grams','份量（克）','number'),f('notes','说明','textarea')]:tab==='训练实绩'?[date,f('exercise','动作'),f('sets','组数','number'),f('reps','次数','number'),f('load','外重','number'),f('unit','单位','select',['kg','lb','未知']),f('rpe','RPE（未知留空）','number'),source]:[title,f('start','开始日期','date'),f('goal','目标','textarea'),f('plan','训练安排','textarea'),source];
  case'growth':return tab==='项目与成果'?[f('name','项目名称'),f('stage','阶段'),f('status','状态','select',['计划','进行中','等待','暂停','完成','取消']),f('goal','成果目标','textarea'),f('next','下一步','textarea'),f('evidence','完成证据','textarea')]:[title,f('area','学习或职业方向'),date,f('notes','内容与收获','textarea'),f('evidence','依据或资源链接')];
  case'journal':return[title,date,...(tab==='心情'?[f('mood','心情','select',['愉快','平静','低落','紧张','其他'])]:[]),body,f('factState','内容性质','select',['已发生','计划','想法','待确认']),source];
  case'articles':return[title,f('author','作者'),f('authorship','整理方式','select',['本人原话','人工整理','AI生成','混合']),body,source];
  case'albums':return[f('name','名称'),f('location','原件位置或附件引用'),f('takenAt','拍摄日期（未知留空）','date'),f('notes','说明','textarea')];
  case'schedule':return[title,f('start','开始日期','date'),f('time','时刻（无时刻为全天）'),f('zone','时区'),f('calendar','目标日历'),f('notes','内容','textarea'),source];
  case'time':return[date,f('category','活动领域','select',['睡眠','饮食','运动','工作','学习','玩耍','社交','其他']),f('duration','时长（未知留空）','number'),f('notes','原始记录','textarea'),source];
  case'people':return[f('person','对象'),date,...(tab==='纪念日'?[f('anniversary','纪念日期','date')]:[]),f('notes','互动或纪念内容','textarea'),source];
  case'files':return[f('name','文件名称'),f('location','原件位置'),f('project','关联项目'),f('version','版本'),f('verified','最后核实日期','date'),source];
  case'reports':return[title,f('period','周期','select',['日','周','月','季','年','自定义']),f('from','开始日期','date'),f('to','结束日期','date'),f('project','关联项目'),f('scope','允许读取的来源','textarea')];
  case'outputs':return[f('type','输出类型','select',['报告','PPT','简历','文章','其他']),f('source','来源记录或报告'),f('target','目标账户或文件'),f('scope','允许输出的范围','textarea')];
  case'knowledge':return[title,f('type','资料类型','select',['文章','文件引用','笔记','链接']),f('location','原始位置'),f('scope','允许读取范围','textarea')];
  case'rag':return[f('name','知识库名称'),f('sources','获准资料范围','textarea'),f('embedding','向量模型'),f('chunking','分段规则'),f('version','索引版本')];
  case'agents':return[f('name','Agent名称'),f('goal','用途','textarea'),f('scope','允许读取范围','textarea'),f('tools','拟使用工具'),f('approval','需要人工批准的动作','textarea')];
  default:return[];
 }
}
