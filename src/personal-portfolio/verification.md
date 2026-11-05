# 账户、资产与投资首版叶子模块

基线：`3caa9279ff6bee41159be8654f83758b334f5f74`；分支：`codex/portfolio-first-version-20261105`。

## 复用与取舍

- 核对 [Actual 官方账户说明](https://actualbudget.org/docs/accounts/)：账户名称、当前余额、账户分组与独立于流水的余额视图具有参考价值。
- 固定参考源码：[actualbudget/actual@30ab4fc5d4f4b3a598507254db240835a34a85c9](https://github.com/actualbudget/actual/tree/30ab4fc5d4f4b3a598507254db240835a34a85c9)。已读取该提交 `LICENSE.txt`，为 James Long MIT。未复制其代码、样式、图像或大段文本，因此不引入第三方代码副本。
- 参考账户分组与金额对齐；沿用本项目语义 CSS tokens、RelationFields、现有 React/Next 组件形式。未新增依赖。未引入 Actual 后端、同步或第二流水账本。
- 本切片按本人手工声明保存余额、估值和日期；保留原 PersonalService 为唯一 portfolio writer，PersonalFinanceService 为唯一金融交易 writer。无券商或行情调用。

## 接口

- `model.ts`: `PersonalPortfolio` / `PortfolioPersonal` 严格三分 union，外层 `PortfolioPersonalFields={title,text,occurredOn,personal}`。
- `emptyPortfolioPersonal(kind)`、`validatePortfolioPersonal(input)`、`normalizePortfolioPersonalFields(input)`。
- `portfolioPersonalReferences(personal)` 提取真实 `{id,sourceId,revision}` pin。账户、资产引用固定返回 `{type:'portfolio',link,expectedKinds:['account'或'asset']}`，expectedKinds 是内部派生值，不是请求字段。根 writer 必须在来源/所有权/锁与版本核对内验证该 subtype；项目、领域、主题同现有规则。
- `PortfolioFields({value,onChange,options,disabled?})`；options 与既有 RelationFields 一致，`options.portfolio` 为已授权 PublicEntry[]。组件不含 portfolioKind 切换，由根表单选择后用 emptyPortfolioPersonal 重置。
- `PortfolioOverview({records,onOpenRecord,onCreateKind?})`；`records:readonly PortfolioRecord[]`，记录形状为 `{id,sourceId,revision,fields}`。`onOpenRecord` 收到整条 PortfolioRecord。
- `projection.ts`: `summarizePortfolio`、`uniquePortfolioRecords`、`portfolioSummary`、`portfolioAmount`、`portfolioAsOf` 与中文标签映射。

## 金额与显示约束

金额为最多30位的 canonical 整数 minor-unit 字符串或 null；账户允许负余额，资产估值/持仓成本与估值非负。输入按币种0/2/3位精度以 BigInt 转换，不做浮点或舍入。手工成本和估值需要 asOf；余额需要 asOf；资产估值需要 valuationOn。日期为真实公历日期。quantity 保留原始非负 decimal 字符串或 null。

支持 CNY/USD/HKD/EUR/GBP/JPY/KRW/TWD/AUD/CAD/CHF/SGD/KWD/BHD；切换币种清空金额，要求重填。同一记录多次出现仅取最高 revision。按 portfolioKind 与 currency 分组列出已知金额、缺失数量与日期范围；不产生跨币种/跨种类总资产或收益。根层仅应提供已验权且已规范化的记录。

## 验证

- 先记录4项领域测试为 RED（缺失实现），再 GREEN；新增 expectedKinds 验收也先 RED 后 GREEN。
- 组件测试先 RED（缺失组件），再 GREEN。
- `node --test test/personal-portfolio-domain.test.ts test/personal-portfolio-fields.test.ts`：6/6。
- `npm run typecheck`：通过。
- 原生 Chrome/Playwright 内部 Next 实际渲染：验证输入金额与日期、CNY/JPY 精度、币种切换清空、负余额、数量字符串与未知成本/估值、Tab键盘导航、390px深色模式字号/触控尺寸和无横向溢出。命令：`RUN_PERSONAL_PORTFOLIO_BROWSER_TESTS=1 LIFEOS_TEST_CHROMIUM_PATH='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' node --test test/personal-portfolio-browser.integration.test.ts`。
- 首两轮浏览器发现控件 label 包含 option 或内联错误文字，使精准可访问名称不稳定；已为选择框和金额输入补充稳定 aria-label。最终原生 Chrome 运行通过（1/1，0 skipped），并已回读桌面与390px深色截图。
- 按根任务要求未重复运行 full suite/build；由根集成后统一执行。

## 未完成边界

本切片不含持久化、Agent/Skill、主工作台路由或服务权限接线；由根集中整合。同一交付仍须包含 scoped Agent/discovery/Skill、共享 writer subtype/CAS/receipt 校验与实际发布读回。内部合成 fixture 不是用户真实财务接入或产品验收。无实时价格、券商交易执行、收益计算或净资产合并。
