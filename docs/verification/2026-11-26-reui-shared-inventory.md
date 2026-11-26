# LO-UI-001 · ReUI 全站控件盘点与共用接口

评审基线为 `Nirvana-Chow/lifeos-app` 远端 `main` 的 `c304d733df8e8640fa5b3de71923c99f5d37f213`。原 ReUI 移植分支 `348f90dd` 的历史已包含在基线中。运动移动入口 [#219](https://github.com/Nirvana-Chow/lifeos-app/pull/219) 的头为 `15f2793694ace92120b2455e5adda68150948b1f`，覆盖运动节、筛选、记录工作台和对应浏览器测试。按月日搜索 [#225](https://github.com/Nirvana-Chow/lifeos-app/pull/225) 的头为 `80b64706605b2872267c6d207aecda2dcd8ae8c9`，覆盖搜索页、弹窗、查询及焦点恢复。上述调用点交给集成负责人结合待审差异处理。本切片只写共用控件及其来源记录，沿用 [Issue #30](https://github.com/Nirvana-Chow/lifeos-app/issues/30) 和 [现有 OpenSpec 1.2 / 3.1 / 3.2](../../openspec/changes/unified-business-ui/tasks.md)。

## 共用接口与迁移边界

| 控件 | 采用 |
| --- | --- |
| 状态徽标 | `src/ui-review/ui/badge.tsx` 使用固定上游 ReUI Badge。保留 `asChild`、`className`、原有六种 `variant`、自定义数据属性、可见文本、长文本换行和焦点样式。色调从现有语义 tokens 获取。调用方沿用现有导入路径。 |
| 普通动作和标准文本字段 | 使用 `src/ui-review/ui/button.tsx` 和 `input.tsx` 中已采用的 shadcn 基础控件。保持 button type、禁用、按下态、无障碍名称、label、name、本地约束及自动填充。交互链接保留原 href 与浏览器原生链接行为，适合统一外观时可使用 `Button asChild`。 |
| 对话框、浮层、卡片 | 复用现有 shadcn Dialog 与 Card，以及已经使用的 Radix Popover。Dialog 保留作用域容器、标题、关闭行为、焦点回归及保存保护。保留源内容的标题级别。 |
| 表格与看板 | 已有官方 ReUI Data Grid 和 Kanban，沿用表格行 ID、ARIA 行位置、虚拟化、分类、拖拽、键盘及原始写入回执。网格目录下 Checkbox、Spinner 分别是本地 Radix 和 Lucide 适配。 |
| 提示、分组面板 | 固定官方 ReUI Alert 与 #229 的 Frame 共用接口详见下节。Frame 用于分组面板，现有 Card 可继续承载简单内容。 |
| 表单专用输入 | 原生 `select`、日期、邮箱、密码、文件、复选框、数字、`textarea` 及 `datalist` 承担平台键盘、自动填充、IME、验证、文件选择、表单提交和辅助技术行为。已核对上游 Date Selector、Number Field、Phone Input、Autocomplete，允许单独证明行为等价后迁移。 |
| 专用视图和安全文档 | 日历网格、训练及总览 ECharts、待办/项目甘特、要求交付证据、日历同步、媒体进度、烹饪记录、存储审查 HTML、OAuth/MFA/恢复等保留各自语义和交互。上游虽有 Gantt、Event Calendar、File Upload，仍须各自对齐日期尺度、时区、重复规则、原始浏览器文件提交、CSP 及业务保存回执后再讨论替换。 |

上游 ReUI 固定在 [`067aa0dc7f8bbfec1cd76fc5ad31f842be5f569a`](https://github.com/keenthemes/reui/tree/067aa0dc7f8bbfec1cd76fc5ad31f842be5f569a)。ReUI 官方 Registry 明确区分 `@reui/*` 与 shadcn 基础控件。此候选复用既有 npm 锁定的 Radix、CVA、class 合并和 Tailwind 4。徽标的源码路径、SHA-256 和本地适配列于 [provenance.json](../../third-party/reui/provenance.json)，上游 MIT 全文位于 [LICENSE](../../third-party/reui/LICENSE)。[Registry 文档](https://reui.io/docs/registry)

建议按已拆分职责交接。壳与账号负责导航、动作和表单外观。表格工作区负责待办、需求、日记和搜索已存在的适配。领域模块分别负责日程、健康、财务、人物、媒体、履历、作品集和烹饪。所有调用方复用本节的共用接口，保留各自请求、权限和回执。

### 日程时区、搜索和标题输入

| 入口 | 现行接口和官方关系 |
| --- | --- |
| 日程时区 | 时区值和校验沿用日程与 Apple 预演现有流程。ReUI [`c-combobox-6`](https://github.com/keenthemes/reui/blob/067aa0dc7f8bbfec1cd76fc5ad31f842be5f569a/registry-reui/bases/radix/components/combobox/c-combobox-6.tsx) 是使用 [stock shadcn Combobox](https://github.com/keenthemes/reui/blob/067aa0dc7f8bbfec1cd76fc5ad31f842be5f569a/registry/bases/radix/ui/combobox.tsx) 的分组例子，底层引入 `@base-ui/react`，示例值为展示字符串。若后续要补时区搜索，仍须保留 IANA ID、已有固定偏移和输入校验。`date-selector` 是日期控件，`time-picker` 是时刻控件。 |
| 搜索 | `src/personal-search/view.tsx` 继续导入 `src/ui-review/ui/input.tsx`，`dialog.tsx` 继续用共享 Radix Dialog。ReUI [`c-input-30`](https://github.com/keenthemes/reui/blob/067aa0dc7f8bbfec1cd76fc5ad31f842be5f569a/registry-reui/bases/radix/components/input/c-input-30.tsx) 是 stock Input 的外观例子。[`c-input-group-20`](https://github.com/keenthemes/reui/blob/067aa0dc7f8bbfec1cd76fc5ad31f842be5f569a/registry-reui/bases/radix/components/input-group/c-input-group-20.tsx) 组合 stock InputGroup 和搜索图标。搜索词、过滤、提交、结果焦点及 #225 的月日与翻页约定沿用搜索接口。 |
| 标题 | 表单新采用共享 `Input` 时沿用 `src/ui-review/ui/input.tsx`。ReUI [`c-input-1`](https://github.com/keenthemes/reui/blob/067aa0dc7f8bbfec1cd76fc5ad31f842be5f569a/registry-reui/bases/radix/components/input/c-input-1.tsx) 组合 stock Field 和 Input。网格内联编辑沿用既有首字符、IME、Enter/F2/Escape 与写入回执契约。`#227` 的 stock Input 过渡头 `df08257b8641ae9257b7429b91692ceadd6e3f25` 已暂停，盘点未计作 ReUI 采用。 |

徽标出口为 `src/ui-review/ui/badge.tsx`，实现位于 `src/ui-review/reui/badge.tsx`。

### Alert 与 Frame 接线合同

追加候选从 #228 的 `0bdaa67d615f0fdf9a5f7901521882d1ee12e1cd` 开始。Alert 与 #229 的 Frame 均来自相同的 ReUI Radix Registry 提交，使用现有 CVA、`cn` 和 LifeOS 主题变量。Alert 业务调用保留给各组独立验证。

| 出口 | 现有调用与接线 |
| --- | --- |
| `src/ui-review/reui/alert.tsx` | `Alert`、`AlertTitle`、`AlertDescription`、`AlertAction`。搜索 `view.tsx` 的失败与登录提示、日历 `personal-workbench.tsx` 的读取失败与待核对提示、设置 `account-api-keys.tsx` 的读取错误与现有重试动作都可以采用。只替换现有完整提示。使用 `AlertDescription` 放原内容，按需用 `AlertAction` 放原动作。已有 `role="alert"`、`role="status"`、`aria-live`、`aria-atomic`、ref 和 tabIndex 原样传递。默认外观没有隐式播报。已具有错误颜色的提示可用 `variant="destructive"` 复用现有危害色，其他用默认外观。已有纯文本播报节点继续使用其原标记。 |
| #229 的 `src/business-reui/frame.tsx` | `Frame`、`FrameHeader`、`FrameTitle`、`FrameDescription`、`FramePanel`、`FrameFooter`。Frame 通过 `asChild` 保留已有 `section`、`article` 或 `li`。日历查看、编辑、详情及设置分组各自验证标题级别、键盘顺序和滚动关系。FramePanel 默认裁切溢出，若现有浮层或焦点轮廓依赖面板外空间，可由调用处显式传入 `className="overflow-visible"` 后复验。 |

Frame 固定接线头为 [#229 `b25ff435`](https://github.com/Nirvana-Chow/lifeos-app/blob/b25ff435ad211f158c7625a5f974109a168f8c07/src/business-reui/frame.tsx)，共七个业务导入点。组合评审从 #228 取 Alert，从 #229 取 Frame 及其既有调用。两项来源合入同一个 `third-party/reui/provenance.json`，沿用目录里的同一份 MIT 全文。

固定源码与 MIT 哈希见 [provenance.json](../../third-party/reui/provenance.json)。[Alert 源码](https://github.com/keenthemes/reui/blob/067aa0dc7f8bbfec1cd76fc5ad31f842be5f569a/registry-reui/bases/radix/reui/alert.tsx) · [Frame 源码](https://github.com/keenthemes/reui/blob/067aa0dc7f8bbfec1cd76fc5ad31f842be5f569a/registry-reui/bases/radix/reui/frame.tsx)

独立浏览器复验命令

```sh
RUN_REUI_ALERT_BROWSER_TESTS=1 LIFEOS_TEST_CHROMIUM_PATH=/usr/bin/chromium \
  node --test test/reui-alert-browser.integration.test.ts
```

## 固定基线的模块明细

统计范围是 `app`、`components`、`src` 里的 Git 跟踪 TSX。表中数字是语法树中的静态 import/export 或 JSX 标签计数。动态渲染次数、条件分支与间接依赖需从入口向下读取。锚点是导航语义，也列入原生项。局部动态导入 ECharts 见 `src/ui-review/overview-chart.tsx`、`src/personal-health/trend.tsx` 和 `src/personal-health/xunji-log/chart.tsx`。独立存储审查 HTML 经 `app/personal/storage-review/route.ts` 返回，属于表格之外的文档渲染路径。

| 模块 | TSX | ReUI 直接引用 | shadcn 直接引用 | JSX HTML 控件 | 其他直接引用 |
| --- | ---: | --- | --- | --- | --- |
| `app` | 37 | — | — | a ×1、button ×2 | — |
| `components/ui` | 1 | — | — | — | — |
| `src/admin-preview` | 1 | — | — | — | — |
| `src/business-mcp-oauth` | 2 | — | button ×1、input ×1 | a ×2、button ×2 | — |
| `src/calendar-candidate` | 5 | data-grid ×1、data-grid-table-virtual ×1 | button ×3、card ×1、dialog ×1 | a ×1、button ×11、details ×5、input ×14、input:checkbox ×2、input:date ×12、input:month ×1、input:search ×1、select ×9、summary ×5、table ×1、textarea ×2 | — |
| `src/cooking` | 5 | — | button ×2 | a ×6、button ×1、input ×1、input:date ×1、input:search ×2、textarea ×1 | — |
| `src/file-handoff` | 2 | — | badge ×1、button ×2、dialog ×1、input ×1 | a ×1、input:checkbox ×3 | — |
| `src/finance-workbench` | 2 | — | — | a ×2、button ×19、datalist ×1、details ×4、input ×5、input:checkbox ×1、input:date ×2、select ×2、summary ×4、textarea ×1 | — |
| `src/import-preview` | 1 | — | — | a ×1、button ×2、details ×1、input:checkbox ×1、summary ×1、textarea ×1 | — |
| `src/journal-candidate` | 1 | — | — | a ×1、button ×9、details ×2、input ×1、input:checkbox ×2、input:date ×1、summary ×2、textarea ×1 | — |
| `src/personal-candidate` | 30 | data-grid ×1、data-grid-table-virtual ×1 | badge ×1、button ×5、dialog ×5、input ×2 | a ×13、button ×40、details ×10、input ×8、input:checkbox ×10、input:date ×5、input:email ×2、input:password ×10、input:text ×4、select ×19、summary ×10、textarea ×6 | — |
| `src/personal-career` | 4 | data-grid ×1、data-grid-table ×1 | button ×1 | a ×1、button ×7、details ×4、input ×6、input:checkbox ×1、input:date ×1、input:url ×2、select ×6、summary ×4、textarea ×3 | — |
| `src/personal-daily` | 1 | — | — | — | — |
| `src/personal-finance` | 3 | data-grid ×1、data-grid-table-virtual ×1 | button ×1、dialog ×1 | datalist ×2、details ×2、input ×5、input:date ×1、select ×3、summary ×2、textarea ×1 | — |
| `src/personal-health` | 9 | — | button ×4 | a ×3、button ×2、details ×3、input ×2、input:file ×1、input:number ×2、input:search ×1、input:text ×1、select ×11、summary ×3、table ×3 | — |
| `src/personal-journal` | 3 | — | button ×2 | a ×4、button ×1、details ×10、input:date ×1、select ×1、summary ×10、table ×1 | — |
| `src/personal-media` | 4 | — | — | button ×1、details ×2、input ×2、input:date ×2、input:number ×3、input:search ×1、input:url ×1、progress ×1、select ×6、summary ×2、textarea ×1 | — |
| `src/personal-people` | 2 | — | button ×1 | details ×1、input ×3、input:date ×1、input:email ×1、input:tel ×1、summary ×1、textarea ×1 | — |
| `src/personal-portfolio` | 2 | — | — | button ×3、details ×1、input ×3、input:date ×1、input:text ×1、select ×4、summary ×1 | — |
| `src/personal-search` | 3 | — | button ×1、dialog ×1、input ×1 | a ×4、button ×2 | — |
| `src/record-window-workbench` | 1 | — | — | button ×8、details ×5、input ×1、input:checkbox ×1、input:date ×2、input:search ×1、select ×2、summary ×5 | — |
| `src/records-workbench` | 2 | — | — | button ×32、details ×6、input ×2、input:checkbox ×2、input:number ×1、select ×9、summary ×6、textarea ×6 | — |
| `src/session-duration` | 3 | — | — | a ×2、button ×4、input:number ×1、select ×2 | — |
| `src/storage-review` | 2 | — | button ×1、input ×1 | a ×2、dialog ×1、input:file ×1、progress ×1、select ×2、textarea ×1 | — |
| `src/tasks-workbench` | 1 | — | — | a ×1、button ×12、details ×2、input ×1、input:date ×1、select ×2、summary ×2、textarea ×1 | — |
| `src/ui-review` | 34 | data-grid ×4、data-grid-cell-selection ×1、data-grid-table ×1、data-grid-table-virtual ×3、kanban ×1 | badge ×2、button ×15、dialog ×2、input ×2 | a ×26、button ×25、details ×6、input ×6、input:checkbox ×1、input:date ×2、input:search ×2、select ×22、summary ×6、table ×1、textarea ×6 | checkbox ×1、Checkbox ×1、Dialog ×1、Popover ×1、Slot ×3、spinner ×2 |
| `src/workbench` | 16 | — | button ×1、card ×7 | a ×5、button ×53、details ×16、dialog ×3、input ×10、input:checkbox ×2、input:date ×2、input:password ×2、input:radio ×1、select ×8、summary ×16、table ×1、textarea ×2 | — |

### 路由与模块入口

- `app/account/api-keys/page.tsx` → `platform`
- `app/account/mcp/page.tsx` → `platform`、`business-mcp-oauth`
- `app/account/mfa/page.tsx` → `session-duration`、`platform`、`personal-candidate`、`business-mcp-oauth`
- `app/account/password/page.tsx` → `platform`、`personal-candidate`
- `app/account/recover/page.tsx` → `personal-candidate`、`platform`
- `app/error.tsx`
- `app/layout.tsx` → `workbench`
- `app/login/page.tsx` → `ui-review`、`session-duration`、`personal-candidate`、`platform`、`business-mcp-oauth`
- `app/page.tsx` → `ui-review`、`platform`、`personal-candidate`
- `app/personal/[...section]/page.tsx` → `personal-search`、`personal-people`、`personal-candidate`、`calendar-candidate`、`personal-finance`、`platform`、`workbench`、`ui-review`
- `app/personal/activity/page.tsx` → `personal-candidate`、`personal-daily`、`personal-journal`、`ui-review`、`platform`
- `app/personal/career/page.tsx` → `platform`、`personal-candidate`
- `app/personal/cooking/[id]/page.tsx` → `cooking`、`platform`
- `app/personal/cooking/history/page.tsx` → `cooking`、`platform`
- `app/personal/cooking/page.tsx` → `cooking`、`platform`
- `app/personal/development-projects/page.tsx` → `personal-candidate`、`platform`、`ui-review`
- `app/personal/edit/page.tsx` → `agent-api`、`platform`、`personal-candidate`
- `app/personal/error.tsx`
- `app/personal/file-handoffs/page.tsx` → `platform`、`ui-review`、`file-handoff`
- `app/personal/journal/page.tsx` → `platform`、`personal-journal`
- `app/personal/layout.tsx` → `ui-review`、`personal-candidate`、`platform`、`session-duration`、`workbench`
- `app/personal/media/page.tsx` → `platform`、`personal-candidate`
- `app/personal/oauth/continue/page.tsx` → `business-mcp-oauth`
- `app/personal/oauth/page.tsx` → `business-mcp-oauth`
- `app/personal/page.tsx` → `agent-api`、`platform`、`personal-candidate`、`workbench`
- `app/personal/portfolio/page.tsx` → `platform`、`personal-candidate`
- `app/personal/requirements/feedback/page.tsx` → `platform`、`ui-review`
- `app/personal/requirements/roadmap/page.tsx` → `platform`、`ui-review`
- `app/personal/requirements/updates/page.tsx` → `platform`、`ui-review`
- `app/personal/resume/page.tsx` → `platform`、`personal-candidate`
- `app/personal/schedule/page.tsx` → `platform`、`personal-candidate`、`calendar-candidate`
- `app/personal/storage-review/workbench/page.tsx` → `personal-candidate`、`storage-review`
- `app/personal/task-classification-preview/page.tsx` → `platform`、`personal-candidate`
- `app/review/admin/[...section]/page.tsx` → `workbench`
- `app/review/admin/layout.tsx` → `workbench`、`platform`
- `app/review/admin/page.tsx` → `workbench`
- `app/review/admin/personal/page.tsx` → `personal-candidate`、`platform`

## 候选验证

- LifeOS Web Cloud 使用 Node `24.22.3`、Chromium `156.0.8078.79` 和原 npm 依赖锁（SHA-256 `a2397f23359e353dd011da547459b9b28accc4fb673fbdff0ea3e3fe1ef070a9`）。源文件和 MIT 全文均与固定上游的哈希记录对应。
- `npm run typecheck`、34 项定向 Node 测试、OpenSpec 1.16.0 严格验证通过。
- 以工作树内的锁定依赖运行 `LIFEOS_PLATFORM_CANDIDATE=0 npm run build -- --webpack` 和 `LIFEOS_PLATFORM_CANDIDATE=0 node scripts/check-built-platform.mjs` 均通过，Build ID 为 `kLeBAz8xsULYva1B7SXOa`。最初依赖软链接使独立产物报告 27 个工作树外文件，已改用工作树内依赖复跑。
- 需求池合成用户从相同入口运行改前与改后测试，覆盖 1365px 和 390px、详情编辑、独立读回、空结果、失败和不完整快照。两组同尺寸截图像素差均为 0。
- 候选需求多视图合成浏览器测试 30 项通过，含 1920px、1365px、390px 的浅色和深色以及 390×400。文件交接和原密钥页合成浏览器测试在 390px 通过，涵盖文件校验、权限、键盘和恢复。
- 验证范围是共享控件候选及其受测消费者。其他业务入口的浏览器覆盖、生产版本回读和本人验收仍在各自交付阶段。

## 单一评审候选

对照从共同基线 `c304d733df8e8640fa5b3de71923c99f5d37f213` 出发。内容来自 [#228](https://github.com/Nirvana-Chow/lifeos-app/pull/228) 的 `1470e0c8dd0282c2aa434faf0101c4812963f2b3)、[#229](https://github.com/Nirvana-Chow/lifeos-app/pull/229) 的 `b25ff435ad211f158c7625a5f974109a168f8c07)、[#230](https://github.com/Nirvana-Chow/lifeos-app/pull/230) 的 `6e1339922913da745da8f12c5b7c1bb5e4db4724`。保留一份 `src/business-reui/frame.tsx` 和一份 `src/ui-review/reui/alert.tsx`，两者逐字等于固定候选。#229 的最终补充只调整通知文字，组合时已保留同等归属。九条上游路径、九条落地路径及 SHA-256 已独立核对，使用同一份 MIT 全文。合成阶段补上了待办网格源测试对 Badge 的渲染占位映射，原行为断言继续运行。

远端 `main` 的 `1cba0e7b18d0abd977b71cde162f27691126999d` 含 #222 的文章、词汇学习、文件索引和项目报告变更。该合并提交及其功能不属于 ReUI 评审基线。公开请求未能独立返回正式运行提交，因而这份对照只证明所列源码和合成浏览器呈现。#219、#225、#227 均留在各自评审范围。

### 覆盖盘点

| 状态 | 入口与控件 |
| --- | --- |
| 已改 | 总览三栏采用共同 Frame，日程与随手记不可用提示采用 Alert，已有 Apple 日历状态使用 Badge。待办网格状态、看板列计数、记录保存回执和媒体状态使用共同 Badge。做饭、履历、财务、健康动作库、媒体、人物和开发项目的分组采用共同 Frame。 |
| 本就适用 | 待办、记录以及日程、财务等有直接 ReUI Data Grid 引用的入口仍沿用既有实现和编辑合同。既有 ReUI Kanban 继续负责拖放。Button、Input、Dialog 和 Card 仍按实际来源记为共享 shadcn/Radix。 |
| 官方无直接等价 | 财务资金流、总览与训练图表、领域关系图以及原生文件选择、独立存储审查文档和身份流程自带业务语义，沿用各自现有实现。 |
| 仍待逐入口验收 | 共享设置和导航目前保有原路由与控件。搜索、日程和账户等仍有其他原生控件和候选调用点。尚未对文章、学习、文件索引、项目报告以及每个模块的所有状态做 ReUI 覆盖复验。 |

下一项建议选固定官方 [DataGridColumnVisibility](https://github.com/keenthemes/reui/blob/067aa0dc7f8bbfec1cd76fc5ad31f842be5f569a/registry-reui/bases/radix/reui/data-grid/data-grid-column-visibility.tsx)，让 390px 待办的列显示选择在现有列设置内以键盘可操作的菜单展开。沿用当前 TanStack 可见性状态、工作区隔离和本地保存，保留标题列与完成列、列顺序、恢复默认和编辑期间禁用。这项选择留在后续评审。

合成浏览器从实际 `/personal` 和 `/personal/cooking` 入口渲染。前后使用同一份合成待办、随手记、日程和菜谱数据。1365px 与 390px 均留存原生 PNG，日程与随手记来源不可用状态也留存同宽对照。总览变化集中在分组边框、间距、徽标和原状态提示的呈现。手机总览的双层边框在截图中可见，做饭页的主要交互可见位置保持接近。

组合候选通过 47 项定向 Node 测试、完整 webpack 生产构建和编译产物检查（Build ID `W-Epz83LlXUj74qo-yDqK`）。看板完整交互仍待验证，#230 的既有夹具记录了候选与原基线相同的列数预期差异。
