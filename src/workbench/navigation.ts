export type ModuleId='overview'|'search'|'records'|'inbox'|'todos'|'finance'|'health'|'growth'|'journal'|'articles'|'albums'|'chat'|'knowledge'|'rag'|'agents'|'workflows'|'executions'|'approvals'|'tools'|'settings'|'ai-settings'|'database'|'schedule'|'time'|'people'|'files'|'reports'|'outputs';
export type WorkbenchModule={id:ModuleId;title:string;href:string;group:string;icon:'grid'|'records'|'book'|'tools'|'file'|'check'|'search'|'star';tabs:readonly string[];columns:readonly string[];emptyTitle:string;emptyText:string;action:string};
const root='/review/admin';
const make=(id:ModuleId,title:string,path:string,group:string,icon:WorkbenchModule['icon'],tabs:readonly string[],columns:readonly string[],emptyTitle:string,emptyText:string,action=''):WorkbenchModule=>Object.freeze({id,title,href:id==='todos'?'/personal?page=tasks':root+path,group,icon,tabs,columns,emptyTitle,emptyText,action});
export const workbenchNavigation:readonly WorkbenchModule[]=Object.freeze([
 make('overview','总览','','工作台','grid',[],[],'','',''),
 make('search','统一搜索','/search','工作台','search',[],[],'尚未开放本人检索','按关键词和日期查找已授权记录，并返回原文。',''),
 make('records','记录','/records','工作台','file',['全部记录','来源与更正'],['日期','标题','类型','来源'],'真实记录尚未接入','先完成本人账号与来源授权。','录入记录'),
 make('inbox','收件箱','/inbox','工作台','records',['待审核','待处理','资料'],['输入时间','原始内容','来源','处理状态'],'收件箱尚未接入','原文和AI草稿会在这里等你核对。','添加输入'),
 make('todos','待办','/todos','生活','check',['待办','进行中','已完成'],['事项','期限','来源','状态'],'待办来源尚未接入','保留原来源和截止时间，避免重复创建。','新建待办'),
 make('finance','财务','/finance','生活','grid',['流水','账户','分类与对账'],['日期','收支类型','金额','账户','来源'],'财务数据尚未接入','流水、转账、退款和账户方向分开核对。','录入流水'),
 make('health','运动健康','/health','生活','star',['训练计划','训练实绩','身体指标','饮食'],['日期','项目','计划或实际','来源'],'运动健康尚未接入','计划不当作实绩，缺失指标保持未知。','记录训练'),
 make('growth','学习与职业','/growth','生活','book',['学习','项目与成果','职业资料'],['标题','领域','下一步','关联资料'],'学习与职业资料尚未接入','课程、项目与可核验成果保留共同关联。','添加学习记录'),
 make('journal','日志与心情','/journal','生活','file',['日志','心情','时间线'],['日期','标题','记录方式','原文'],'日志来源尚未接入','本人原话、整理内容与AI推断分别标注。','写一篇日志'),
 make('articles','文章','/articles','内容','book',['文章库','草稿','阅读收藏'],['标题','作者','整理方式','更新日期'],'文章库尚未接入','这里不会用示例文章代替你的内容。','新建文章'),
 make('albums','相册','/albums','内容','grid',['照片','相册','附件引用'],['名称','原件位置','来源','最后核实'],'照片与附件尚未接入','先保存原件引用；本版不上传或搬动照片。','添加照片'),
 make('schedule','日程','/schedule','生活','records',['日程','来源与冲突'],['日期','事项','来源','状态'],'日程来源尚未接入','未读不代表完成，Apple日历写入需预览和确认。','新建日程'),
 make('time','时间分配','/time','生活','grid',['时间记录','覆盖情况'],['日期','活动','时长','来源'],'时间来源尚未接入','缺失时长保持未知，不填满24小时。','记录时间'),
 make('people','人际与纪念日','/people','生活','star',['互动记录','纪念日'],['日期','对象','记录','来源'],'人际资料尚未接入','不读取联系人或编造互动历史。','添加记录'),
 make('files','文件地图','/files','内容','file',['文件索引','项目关联'],['名称','原件位置','来源','最后核实'],'文件索引尚未接入','只记录原件位置和版本，不搬动文件。','添加索引'),
 make('reports','回顾与报告','/reports','内容','book',['周期回顾','项目回顾','来源版本'],['周期','标题','来源版本','状态'],'报告服务尚未接入','生成内容需回溯依据，过期报告需更新。','新建回顾'),
 make('outputs','输出中心','/outputs','内容','file',['导出','同步草稿','公开发布'],['类型','内容','目标','确认状态'],'输出服务尚未接入','导出、同步和发布分开确认；当前不对外写入。','准备输出'),
 make('chat','AI 聊天','/chat','AI 工作台','tools',[],[],'','',''),
 make('knowledge','资料与检索','/knowledge','AI 工作台','search',['资料','检索','来源'],['标题','类型','来源','更新日期'],'知识资料尚未接入','检索结果应回到获准的原始资料。','导入资料'),
 make('rag','RAG 知识库','/rag','AI 工作台','book',['知识库','索引','检索检查'],['名称','读取范围','索引版本','状态'],'检索服务尚未配置','分段、向量模型与索引需要分别验证。','新建知识库'),
 make('agents','Agent','/agents','AI 工作台','tools',['Agent','权限与工具','试运行'],['名称','用途','读取范围','运行状态'],'Agent 执行器尚未接入','工具权限、批准范围和结果需要可追溯。','新建 Agent'),
 make('workflows','固定流程','/workflows','AI 工作台','records',['流程','设计草稿','运行规则'],['名称','触发方式','批准规则','版本'],'流程服务尚未接入','可以先编辑本页草稿，当前不会保存或执行。',''),
 make('executions','执行历史','/executions','运行','file',['全部','运行中','失败与重试'],['时间','流程','来源版本','结果'],'执行器尚未接入','运行、取消、错误和重试会保留同一执行链。',''),
 make('approvals','待审批','/approvals','运行','check',['待审批','已处理','权限范围'],['拟操作','目标','读取范围','申请时间'],'审批服务尚未接入','没有真实请求时，不生成虚构审批事项。',''),
 make('tools','工具与连接','/tools','运行','tools',['连接','工具契约','权限'],['工具','用途','授权范围','连接状态'],'外部工具尚未连接','Skill资料抓取与Apple日历仅是待接入能力。',''),
 make('settings','个人设置','/settings','设置','tools',['账号','隐私','备份与恢复'],[],'本人账号尚未初始化','真实账号、MFA、恢复和私人数据接入需分别完成。',''),
 make('ai-settings','AI 服务设置','/settings/ai','设置','tools',[],[],'','',''),
 make('database','数据库与数据','/settings/data','设置','grid',['数据库','导入导出','数据来源'],[],'个人数据源尚未配置','现有PG仅承载隔离测试，不代表你的私人资料已接入。',''),
]);
export function findModule(path:string):WorkbenchModule|null{return path.replace(/\/$/,'')==='/review/admin/todos'?workbenchNavigation.find(m=>m.id==='todos')!:workbenchNavigation.find(m=>m.href===path.replace(/\/$/,''))??null;}
