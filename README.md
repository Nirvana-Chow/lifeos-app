# LifeOS

把日常需要的工具和信息连接起来，逐步搭建自己的生活工作台。

LifeOS 优先组合成熟组件，围绕任务、记录、日历和个人工作流程迭代。当前是开发预览，源码包含 Next.js 工作台、身份与 MFA、PostgreSQL 适配及隔离合成测试。

**代码公开不代表个人数据公开。** 仓库只提供通用实现、结构迁移和合成样例。默认关闭数据接口；真实身份、数据源和服务配置需要各自完成配置与验证。

## 本地开发

使用 Node.js 24（CI 固定 24.22.1）及 npm：

```bash
git clone https://github.com/Nirvana-Chow/lifeos-app.git
cd lifeos-app
npm ci --ignore-scripts --no-audit --no-fund
npm test
npm run typecheck
npm run dev
```

打开 `http://127.0.0.1:3000`。未配置隔离数据库和身份时，登录页显示不可用，数据 API 保持关闭；不会自动创建账户、迁移数据库或接入外部模型。[环境变量样例](docs/environment-example.txt)仅提供安全的关闭状态，实际配置保留在 Git 之外。

检查构建：

```bash
LIFEOS_PLATFORM_CANDIDATE=0 npm run build -- --webpack
LIFEOS_PLATFORM_CANDIDATE=0 node scripts/check-built-platform.mjs
```

## 验证范围

公开 CI 使用一次性 PostgreSQL 和明确合成身份，分别执行：

- 单元与契约测试、类型、安全审计、构建及编译后默认关闭检查。
- 实际 Auth、记录、AI 配置及日历 PostgreSQL 验证。
- 实际 Next HTTP 登录、权限、幂等保存、限流与 capture 读回。
- 隔离 PostgreSQL 恢复及原生 MFA 验证。

集成用例在普通 `npm test` 中可能显示 opt-in 跳过；CI 单独启用并要求对应报告零跳过。编译后检查是进程内验证，不代表真实 HTTP 或浏览器验收。公开 CI 不执行生产部署，也不证明真实数据、浏览器/TLS、生产恢复或使用体验已经验收。

## 训记训练分析文件

将训记 Skill 已授权读取的逐日 full JSON 放在 Git 外的私人目录。使用离线转换脚本生成分析文件：

```bash
python3 scripts/project-xunji-training-analytics.py --input-dir /path/to/xunji-full-days --output /path/to/training-analytics.json
```

在 LifeOS 的「健康 → 运动 → 训练日记分析」选择生成的文件。页面会在浏览器内计算结果，关闭页面后可重新选择文件。可传 `--start` 和 `--end` 缩小日期范围。原始和分析文件都应保留在 Git 外。

## 参与开发

先读[项目开发规则](AGENTS.md)与[开发协作约定](docs/development/working-agreement.md)。需求通过已授权的业务 API 入原需求池，Issue/PR/OpenSpec 只保留工程映射；外部贡献先通过 Issue 明确问题、行为与验收。后续变更使用 feature 分支与 PR，commit 带需求 ID，不直推 main。独立领域由 Root 直接派子代理到各自 worktree，不继续派生；相关多需求可同轨成批。合并前做适用快速本地检查和独立技术复核，普通 PR 合并组合 main 后，只对固定 main SHA 跑一次全量原 CI/构建/私有自动发布/原 Native + HTTPS 独立读回，不重复 PR/main 长全量流水线；不绕分支保护，失败不发布、保留旧运行版并立即修复。复用现有组件和原生能力，保留单一 `package-lock.json`；变更应包含适用验证及清晰的未完成项。

仓库使用 OpenSpec；生成工作流位于 `.agents/skills/`，CLI 固定 `@fission-ai/openspec@1.16.0`。新需求先形成设计与任务，已有批准范围持续实施；工具状态不能代替功能、权限或真实验收。

请只提交合成数据，清除截图、日志和配置中的私人内容。凭据、个人数据库、导出、备份和实际生活记录都不属于源码贡献范围。

## 许可

自有代码采用 [MIT](LICENSE)，允许使用、修改、分发和商用，需保留许可与版权声明。第三方材料继续适用各自许可，详见 [第三方声明](THIRD_PARTY_NOTICES.md)。
