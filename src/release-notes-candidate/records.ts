/**
 * Reviewed public source records. A note always names the source that supports
 * its copy. The running artifact can match a record, but never reassign it.
 */
export const publicReleaseRecords=[{
 id:'finance-journal-timeline-209',
 sourceSha:'2d0c8df0d83a39a01984f72bcb217de4de3caf7b',
 title:'财务、日记复盘与时间线',
 changes:['财务入口沿用本人工作台的导航与会话保护。','日记周期页可按需核对本期复盘资料，查看已读取的日记和随手记。','评审时间线按修订发生时的实际 UTC 偏移区分历史时间。'],
 requirementIds:['LO-UI-001','LO-JOURNAL-001','LO-TIMELINE-001'],
},{
 id:'development-project-summary-201',
 sourceSha:'40f40919cb8ac3a38caca22e2c7c3a83dc9ec3d0',
 title:'开发项目首屏摘要',
 changes:['通过本人权限核对后，开发项目页只读取一次需求进度摘要。'],
 requirementIds:['LO-REQ-001'],
},{
 id:'owner-workspace-20261113',
 sourceSha:'c2458a8f9786f992b19a6a14209e25e47f3d0925',
 title:'存储审核入口与层级预览',
 changes:['待办支持按项目或领域分组，未分配项目或领域的事项单独展示。','待办支持多行预检、逐项编辑与选择，确认后按顺序保存并独立回读；批次非原子，失败或结果未确认时停止并保留原请求。','可搜索当前授权本人记录的标题与正文，查看覆盖范围，并打开独立读取的原记录只读详情；返回时保留搜索词。','存储审核支持站内进入与返回、按编号展开层级并单独选择待审叶项；保留已有决定和草稿，审核选择不执行文件删除。','菜谱库提供377道带来源的中外菜谱，支持按食材与分类筛选并查看步骤。','日记新增历史上的今天，可查看库内日期覆盖并打开原始记录。','导航按生活维度分组，设置入口更集中，总览可查看领域、项目与下一步。'],
 requirementIds:['LO-FILES-001','LO-TASK-001','LO-CAPTURE-001','LO-SEARCH-001','LO-PROJECT-001','LO-COOK-001','LO-JOURNAL-001','LO-VERSION-001','LO-UI-001','LO-OVERVIEW-001'],
},{
 id:'requirements-owner-source',sourceSha:'e83e8133fe014afd36ba154927572bd51a7e2aca',
 title:'需求池持久化与交付流程调整',
 changes:['需求支持本人保存、编辑、阶段、P0–P3 与计划日期。','需求实现状态与本人验收保持分开；公开需求保留原 ID 和来源。','发布必要资格与独立视觉回归分离；视觉回归未完成项继续保留。'],
 requirementIds:['LO-REQ-001','LO-VERSION-001'],
}];
