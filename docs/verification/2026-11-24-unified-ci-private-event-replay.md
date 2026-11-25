# LifeOS CI 合一与私有事件兼容回放

LO-OPS-001。本地兼容变更基于公开 CI 候选 `fecb8c4d7e1285dd9a139d72c738ef05a860b921`，旧双入口样本取固定父提交 `01a73a329212067c9aa555774ec0343696a38bfc` 的工作流字节。两个版本的样本均使用合成事件和 API 记录。本轮的 workflow ID、run ID 和 attempt 是合成值。

- `scripts/release_event_compat.py` 是纯验证适配器。现有私有签名接收器负责传入已认证事件，现有 worker 负责读取固定源清单、选择已审核契约、独立判定 scope、读取并提交权威 evidence。适配器比对工作流字节 SHA-256、仓库与 main push、成功完成状态、精确源 SHA / run / attempt、命名 jobs、最终门禁步骤和适用产物，最后申请一次原子源认领。
- `test/release_event_compat_test.py` 回放两代契约、四种统一 scope、异常事件及证据、旧路径回退和重复认领。临时 SQLite 唯一键负责模拟一个持久认领，样本覆盖并发重复、重新打开数据库、重跑 attempt 和旧双事件交错。私有 worker 须提供自身持久认领和队列恢复能力。
- 公开工作流、原私有适配器、镜像配方和应用源码沿用原候选。静态核验确认一个工作流、各一次单元测试/类型检查/依赖审计、一个 Docker 构建调用及同一镜像 ID 的编译核验和 TLS 用途。私有侧样本验证一次构建认领。正式 Native 验真、Auth / MFA / 数据 / TLS 的 hosted 实跑和部署验收沿用现有门禁。

## 合成样本

| 样本 | 结果 |
| --- | --- |
| 统一 main push，源 `fecb8c4…`，run 4101，attempt 2 | 四种 scope 各自通过，返回原 tuple。Full 或 UI 按范围核对同次命名产物，例 `lifeos-compiled-fecb8c4…-4101-2` |
| 同次并发重复、进程后续读取、同源重跑 | 只有一次以仓库 ID 与 SHA 为键的认领。后续返回 `SOURCE_ALREADY_CLAIMED` |
| 空或缺事件、未认证、旧源、旧 run 或 attempt、错误分支或事件类型 | 在认领前拒绝 |
| 缺、空、重复或跳过的必需工作、缺门禁步骤、旧或过期产物 | 在认领前拒绝 |
| 旧 `qualification.yml` 唤醒统一契约 | 拒绝，统一契约只接受 `ci.yml` |
| 旧 `qualification.yml` 唤醒明确批准的回退契约 | 只有受信旧 SHA 的旧 release 和旧 full 配对证据均通过时，才能申请认领。随后旧 CI 的完成事件共用同一个键 |
| 旧资格缺失、跳过或借用统一 SHA | 拒绝。回退由外部批准的旧源契约显式选择，使用已完成的旧证据，无需恢复工作流入口 |

重放命令如下。仓库须包含两个固定的历史提交对象。

```bash
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s test -p release_event_compat_test.py -v
```

## 私有上线前的阻断

历史验收记录显示，两个旧完成事件曾由私有签名接收器写入持久队列并交给私有发布器。当前可读来源仍缺实际安装的接收器与 worker 的独立归属和字节。GitHub 的完成事件在兼容层仅作为唤醒。真实的 canonical Actions run/attempt、证据产物、签名和 worker 认领均由既有私有边界提供。 [历史验收记录](2026-11-05-unified-ui-qualification.md) · [GitHub workflow_run 事件契约](https://docs.github.com/en/webhooks/webhook-events-and-payloads#workflow_run)

唯一下一步由私有 CD 的 Root 所有者负责。提供当前已部署接收器和 worker 的脱敏只读快照及独立摘要，覆盖真实事件过滤、工作流 ID/路径、worker/config pin、scope 与证据契约、artifact 可见性和保留窗口、原子认领及失败后恢复、批准的旧源回退边界。回读后再把本地契约与实际 worker 逐项对照。当前变更仅为可重放的本地伴随候选。首次 hosted 验证和私有切换待验。
