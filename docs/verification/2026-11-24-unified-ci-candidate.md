# LifeOS 单工作流本地候选

基线为 `01a73a329212067c9aa555774ec0343696a38bfc`。本候选属于 LO-OPS-001 的公开 CI 范围，供本地验收。正式发布切换需要私有消费者的独立验收。

## 公开 CI 契约

`.github/workflows/ci.yml` 沿用 `LifeOS public source CI`、`Unit, types and source contracts` 和 `Release eligibility`，监听 main push 和指定 main 的手动运行。公开权限仍为 `contents: read`、`actions: read`。手动运行执行 full，额外 UI 资格检查由 `visual` 布尔输入启用。Push 的 UI scope 取实际推送的两棵 Git 树。不能确认事件、祖先或路径时，门禁失败。

| Scope | 必须成功的前置任务与 evidence |
| --- | --- |
| routine，无 UI 变更 | 策略、单元测试、路由类型生成、类型检查、锁定依赖安全审计 |
| routine，有 UI 变更 | routine 基础项、同一镜像的编译后关闭态核验、TLS 浏览器和 journal、桌面及手机 UI 断言、有限截图证据 |
| full，无 UI 变更 | 基础项、同一镜像和编译产物、隔离 Auth / 权限 / PostgreSQL、原生 MFA / 恢复、TLS 恢复及 permit 吊销、登录与数据安全浏览器场景、journal |
| full，有 UI 变更 | full 安全与数据项及额外 UI 断言和证据。共用一次 TLS 浏览器场景 |

完整资格保留独立的 PostgreSQL 服务、restricted role、Auth / TOTP、issuer socket、授权和吊销、数据隔离、恢复和回读。保留 TLS、证书信任清理、中文 CJK 字体验证及 JUnit 零跳过守卫。需要镜像时使用原 Docker 配方打包一次，关闭态检查、TLS 和浏览器使用同一镜像 ID。Full 的 Next HTTP 检查下载从该镜像提取的限期归档，按 artifact ID 校验摘要并核对 Build ID。

相关 UI push 在一个任务中做桌面和手机检查，并上传一份含 118 张明确列名的合成截图和 manifest。原有限路径、内容和 PNG 哈希守卫继续执行，产物名与 manifest 均绑定 SHA、run、attempt，manifest 还绑定 Build ID。Full 的安全浏览器场景仍适用，UI 不在 scope 时只执行安全和数据组。当前构建的客户端资源清单仍记录在 UI 运行日志中。

移除两个独立工作流的入口、重复源码检查、当前源码的重复构建及跨工作流轮询。历史 VTable 对照构建和测量退出普通发布路径。原脚本、历史结果和固定配方保留，可从基线的 `.github/workflows/visual-qualification.yml` 追溯历史基线及取证步骤。

`Release eligibility` 直接依赖全部前置任务，用当前 attempt 的 GitHub 任务记录逐项核对命名生产者及必需步骤，并查验适用的命名产物。允许策略计划内的跳过。失败、取消、缺失、意外跳过、错 SHA、错 run 或错 attempt 都阻断。Partial rerun 缺少同一次 attempt 的必需生产者会阻断。门禁运行时只读前置任务和证据。

`.github/release-full-green.json` 原样保留。首次统一运行强制 full。新锚点只从已完成且成功的早先 main push 识别，核验原信任锚、Git 祖先关系、工作流和门禁源字节、同次 attempt 的命名任务和步骤及 full 索引。当前运行不能用自身做基线。首次 attempt 的成功 full 可以发布新索引，手动运行和后续 attempt 可以完成资格检查，索引保留给符合条件的首次 main push attempt。

## 本地验收

- `actionlint` 1.7.12 通过。静态解析确认单一 YAML、六任务 DAG、47 个 Bash 步骤及内嵌 Python 语法。
- 路由类型生成和 `npm run typecheck` 通过。10 个相关测试文件共 128 项通过，零跳过。
- 额外合成检查覆盖 8 个历史锚点与祖先情形、8 个截图 manifest 情形。缺失和错误证据按预期拒绝，包括同名任务或步骤、部分重跑、错 SHA/run/attempt、过期产物和图片摘要不符。

## 首次 hosted 验收与私有切换

- 取得单独授权后验证 hosted 的确切 SHA / run / attempt，包括首次 full 加 UI、同份编译输出的上传和下载、镜像内关闭态检查、浏览器与 PNG 清单、命名步骤、artifact API 读回和历史锚点采用。随后在有相应变更的受控运行验证 routine、UI scope 和部分重跑失败路径。当前本地证据来自合成任务、产物、JUnit 和 Git 记录。
- 公开历史记录说明私有接收器处理签名的 `workflow_run` 事件，仓库内的旧 Python 适配器仍识别独立 `qualification.yml`。应由私有消费者所有者读回实际接收器、worker、配置、受保护状态和快照契约，确认实际 pins、旧事件及检查名称、可回退的启用边界。公开预检仍要求旧快照提供三条原 pin。删除的文件在候选侧报告为 pin 漂移。
- 私有切换须审查旧版与统一版两个固定契约及精确切换版本。统一版消费者独立核验签名、仓库、main push、已完成的正确工作流 SHA/run/attempt、适用范围和全部必需证据，排除跳过及旧 attempt。保持私有 Native 构建、源到运行镜像验真、HTTPS、恢复和回退门禁。核对 GitHub 要求的检查名称与实际私有订阅，使用同一固定 SHA 在获授权的环境验证后再采用。
- 当前交付状态为本地候选。私有部署兼容、实际 GitHub runner、正式环境与 owner 验收均待独立确认。
