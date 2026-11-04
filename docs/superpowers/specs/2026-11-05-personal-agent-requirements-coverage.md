# PersonalAgent 原34项需求覆盖映射

本表仅把[原需求基线](../../../src/platform/public-requirements.json)的34个稳定ID映射到[新唯一执行任务](../../../openspec/changes/personal-agent-foundation/tasks.md)或[原UI canonical检查表](../../../openspec/changes/unified-business-ui/tasks.md)，不创建需求池或另一份完成状态。原实现证据保留；本次规划没有新增实现、运行、部署或本人验收通过证据。所有新执行项均未勾，原UI仍继承2/5，表中“已有”不表示整项done。

| 原ID | 具体执行承接 | 保留的未完成验收或限定 |
| --- | --- | --- |
| LO-UI-001 | 原UI1.2/2.1/3.1/3.2；本change1.4、2.3、3.3、5.5、9.2–9.6 | 原渲染/交互、renderer基准、交付与本人体验仍待验，不由新页面关闭 |
| LO-AUTH-001 | 1.1、1.2、5.2、8.1 | 现有source边界保留，新入口MFA/同owner/current authority回归及本人验收 |
| LO-PRIVACY-001 | 3.1、4.3、5.1、5.2、8.1–8.2 | 敏感数据加密/密钥恢复、日志、本机unknown保护与独立恢复未据规划验收 |
| LO-VERSION-001 | 8.1–8.2；原UI3.2 | 固定source/artifact/实际运行版本及主流程读回 |
| LO-OPS-001 | 5.1、5.4、8.1–8.3 | 类型/构建/集成/CI、运行/恢复门禁及失败/skip/unavailable分别列明 |
| LO-REQ-001 | 8.3；原UI1.2/3.1/3.2及原Issue30 | 新输入追加/查重、来源/实现/部署/体验状态和原requirements网页资格不丢失 |
| LO-TASK-001 | 2.1–2.3、9.3–9.6；#5 | 真实全覆盖分类、事项Gantt、Kanban拖动、换行批录、删除/restore及API/Skill/网页读回 |
| LO-PROJECT-001 | 1.3–1.4、2.2–2.3、9.1；#7 | 组织API、真实目录/分类、受限scope、关系版本及网页体验 |
| LO-SOURCE-001 | 3.1–3.2、4.1–4.3；#4 | identity/version/mapper/coverage、来源更正使旧引用/报告失效；不覆盖原件 |
| LO-JOURNAL-001 | 6.1；#6 | 本篇autosave/草稿/多标签CAS/unknown/history、人物links、API/discovery/Skill/真实网页 |
| LO-TIMELINE-001 | 6.2、10.3；#8 | 日期精度、跨年/缺日期、过滤回退、专业实体来源回看 |
| LO-SEARCH-001 | 3.2–3.3、9.1；#9 | 当前授权全文前过滤、bounded cursor/coverage、详情跳转；语义检索按评估而非假定已有 |
| LO-DATA-001 | 4.1–4.3、8.2；#10 | source包typed mapping/preview/apply/readback/水位、真实迁移具体包、原件保留 |
| LO-FIN-001 | 6.4；#11 | 退款/转账/还款、账户/余额snapshot authority/币种/asOf、独立对账恢复；缺源不报已连接 |
| LO-SCHEDULE-001 | 6.2、9.3；#12 | 实际事项Gantt与未排期、calendar/occurrence/时区/只读语义、阶段/纪念日；不由dueOn造区间 |
| LO-ARTICLE-001 | 10.1；#13 | 原文/来源、草稿/自动保存/冲突/history及输入API/discovery/Skill，原验收继续 |
| LO-LEARNING-001 | 10.1；#13 | 收藏来源/读回/有权访问及网页录入能力，不拿文章摘要替代收藏事实 |
| LO-OVERVIEW-001 | 3.3、5.5、7.3；原UI1.2/3.1 | 当前待办/项目范围及专业来源入口、四工作台目的地与真实来源状态 |
| LO-HEALTH-001 | 6.3；#15 | 训练/身体/饮食/计划typed含义、单位/组次/时间/截断coverage；未连健康源保持not-connected |
| LO-FILES-001 | 10.2、4.3；#16 | 文件索引/项目回链、附件是否可恢复；不得隐式跨目录迁移/删除/外发 |
| LO-REPORT-001 | 3.1、7.3–7.4、10.4；#17 | 每个结论有依据或unknown、来源更正失效、报告不写成新业务实绩 |
| LO-OUTPUT-001 | 10.4、8.2；#17 | 输出目标/失效检查/明确确认，先synthetic目标；真实外部发布单独具体授权 |
| LO-CAPTURE-001 | 2.2–2.3、5.3、9.5；#18 | cancel/迟到结果/unknown、固定候选审核、输入操作/发现/Skill同片，不自动保存模型输出 |
| LO-AI-001 | 5.1–5.5、7.3–7.4；#19 | 单LangGraph loop、受限checkpoint、成熟worker、硬预算、出站授权和实测评估；代码不等于live启用 |
| LO-BACKUP-001 | 4.3、5.1、8.2；#20 | 当前原状态not_started保留；加密与独立目标恢复逐实体/source/权限/主流程读回，解析不算恢复 |
| LO-AUTH-002 | 1.1–1.2、2.2、3.1、5.1–5.2、7.1；#3 | object/source/checkpoint/cursor/receipt/stream跨owner与space隔离 |
| LO-SEC-001 | 1.2、2.2、5.2、8.1–8.2；#3 | 原生MFA/session/撤销/recovery守卫及新接口负例，禁止管理员cookie或SQL旁路 |
| LO-TIME-001 | 10.3 | 只查获准历史；首次记录日/实际天数/coverage分母、重叠/闰日/时区/修订去重；不恢复退役自动writer |
| LO-PEOPLE-001 | 6.1、9.1；#32 | 本人确认人物/别名/关系，不自动读通讯录或把模型共现当真实关系 |
| LO-EXPERIMENT-001 | 5.1、7.1、10.5 | 固定隔离试验代码/输入/结果，未批准不默认安装或调用外部模型 |
| LO-LEGAL-001 | 10.5 | 地区/来源范围先明确；未批准不导入或启用外部接口，保留官方来源及适用限制 |
| LO-LINK-001 | 6.1、9.1；#33 | closed typed基数、同owner/真实source/revision、反向回看与唯一writer，不任意JSON互连 |
| LO-GRAPH-001 | 9.1–9.2；#34；原成熟图谱选型 | Gephi Lite成熟UI实际探索/边计数/时间过滤/来源drilldown；GPL/独立部署具体包；LangGraph/JSON导出不替图谱 |
| LO-AGENT-001 | 1.1–2.3、5.2、7.1–7.2；#35 | 同Key显式scope、registry/API/discovery/Skill/MCP一致；实际host、只读建议/本人审核/API写边界及固定包 |

原明确paused流程保留其原恢复授权门槛；本目标和新worker不自动恢复它们。退役时间账本只读限定也不因迁移或“了解全部资料”而变更。真实数据/权限/外发/后台费用缺授权，仅暂停依赖的动作，其他已授权开发继续。
