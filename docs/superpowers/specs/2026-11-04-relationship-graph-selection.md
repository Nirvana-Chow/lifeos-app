# 成熟关系图谱方案选型

LO-GRAPH-001 / Issue34 已入池，依赖 LO-LINK-001 / Issue33 的真实关联。当前是调研与推荐，没有图谱代码、依赖安装、个人关系推断、数据上传或运行验收。

本人明确要求使用成熟图谱解决方案。此前“复用已有 ECharts 再补图谱交互”的建议已被本人否决；它不再是实施方向。比较必须区分底层 API、现成 UI 和完整应用，不能把算法存在说成用户已能操作。

## 已核实的候选

版本于2026-11-04从官方registry/release核对；未改变npm锁。

| 方案 | 版本/许可 | 现成功能 | 实际缺口 |
|---|---|---|---|
|[Gephi Lite](https://gephi.org/lite/)|1.1.0 / GPL-3.0，完整应用|搜索、属性/时间筛选、邻域/ego、Louvain社区、布局、图例、节点/边表格、导入导出|中文资源尚未注册；未核实Lite现成最短路径界面；需要本人认证、证据回链、私密部署及许可边界|
|[Reagraph](https://github.com/reaviz/reagraph)|4.32.0 / Apache-2.0，React组件|选择、邻接高亮、折叠展开、套索、径向菜单、camera、路径选择hook、按属性聚合|搜索/属性筛选工作台与证据入口仍需实现；属性聚合不等于Louvain发现；React/Next/WebGL/手机待实测|
|[G6](https://g6.antv.antgroup.com/en/manual/graph/extensions) / [Graphin](https://github.com/antvis/Graphin)|5.1.1 /3.0.5，MIT，引擎与React薄封装|拖动缩放选择、布局、折叠、toolbar/minimap/legend等插件|Graphin3主要是canvas wrapper，不能沿用Graphin2丰富分析面板的宣传；通用搜索/筛选/路径工作流仍需组装|
|[Cytoscape.js](https://js.cytoscape.org/)|3.34.4 / MIT，图分析库|成熟布局、遍历/路径/聚类算法、触摸交互和扩展生态|算法和selector不是完整搜索、属性筛选、路径选择面板，仍需搭探索应用|
|[AWS Graph Explorer](https://github.com/aws/graph-explorer)|3.3.0 / Apache-2.0，完整应用|搜索、类型/属性筛选、邻居扩散、graph/data/schema视图、查询与导出|要求Gremlin/SPARQL或Neptune兼容数据端，与当前PG事实层不直连；embeddable component非目标；不为选UI引入新图数据库|

[G6VP](https://github.com/antvis/G6VP)虽是完整探索平台，官方仓库已于2026-05-19归档，不推荐新引入。Graphin3.0.5的[发布源码exports](https://github.com/antvis/Graphin/blob/937a0a5/packages/graphin/src/index.ts)和[components](https://github.com/antvis/Graphin/blob/937a0a5/packages/graphin/src/components/index.tsx)证明它不含旧版整套UI；不能混用旧示例。Gephi Desktop的插件也不能当Lite现成功能：Lite1.1的[topological注册表](https://github.com/gephi/gephi-lite/blob/90443b3a196ecbd01fe2a16d88498dc6d54be744/packages/gephi-lite/src/core/filters/topological/index.ts)只有ego/k-core/最大连通分量，最短路径仅见注释；[LOCALES](https://github.com/gephi/gephi-lite/blob/90443b3a196ecbd01fe2a16d88498dc6d54be744/packages/gephi-lite/src/locales/LOCALES.ts)未注册中文文件。

## 推荐方向

优先论证 **Gephi Lite完整应用的私有集成**，最接近“成熟产品直接使用”，减少自行搭建探索界面的工作。它独立使用React18.3/Vite，不混装进当前React19树。可通过官方[同源TypeScript driver](https://docs.gephi.org/lite/integration/typescript-driver/)传递只读关联投影和选择结果，再回到LifeOS证据详情。GPL-3.0及独立部署边界需要具体审查；研究本身不授权把其源码混入MIT项目、安装新服务或开启新发布渠道。

如果本人要求与现有页面完全一致且接受补搜索/筛选面板，Reagraph是嵌入式备选。G6/Cytoscape保留为底层对照，不把它们称作完整探索产品。最短路径不是本人当前提出的硬要求，不能因选型研究引入它而拖延真实关联、计数与证据回看；缺口仍如实记录。

## 数据与验收

图谱从同一事实层的明确关联派生，不另建第二业务数据库。节点使用稳定实体ID；边标关系类型、关联次数和所选时间范围，计数可回看构成它的有权记录。布局距离不代表关系强弱或心理重要性；未知日期、未关联记录、修订、去重和筛选分母明确。默认不将文本共现推测为事实关系。

不向公共demo、Gist或第三方服务发送私人图。按[官方部署说明](https://docs.gephi.org/lite/integration/deploying/)关闭外部底图、任意URL加载、GitHub/Gist及未批准的遥测；同源driver不能替代owner/space校验。探索快照的修改不自动写回事实层，退出和换账号时清除图、通道与本地残留。导出或分享另有明确动作。

采用前按固定artifact保留许可/来源，验证手机、键盘/读屏替代列表、暗色、搜索筛选计数、证据回链、网络无外传、会话清理和实际来源一致。当前没有性能排名或验收承诺。内部合成结构仅验证安全与计数，给本人查看的是实际部署后的真实关联。
