# 存储条目备注候选验证

2026-11-14 · LO-FILES-001 / EXEC-STORAGE-NOTES-001 · 原 owner-storage / unified-business-ui 3.1/3.2 / Issue #41。

本切片把备注与处理要求保存到原 owner-space storageReview JSON 的独立 notes 字段。旧无 notes 的清单和决定不变；所有条目包括 protected/processed 与父目录均可备注，原状态和决定不随备注改变。新清单不能静默移除或替换仍有备注的对象。单项原文不trim，最多8000字符，空字符串明确清空；沿原128KiB UTF8持久化上限、CAS、身份锁、授权fence与幂等收据。未新增schema、物理文件处理或数据导入。

已完成的本地验证：

- 59项聚焦 Node 测试，零失败/跳过：原保存、隔离、路由、层级/导航、决定与unknown恢复回归，新备注原文/清空/无操作收据、UTF8大小、丢失回应原key回放、草稿原revision、字段投影和授权guard。
- TypeScript检查通过；依赖固定 lock `720bcc1103fdd7ef7f671612ef078ef6d74924724828dc09ce0072aa2b4b7909`，只读借用同锁依赖，未安装或改锁。
- 实际已安装 Chrome 对原 route response、CSP、owner HTTP/service 运行四个隔离MemoryPort浏览器用例，4P/0F/0S。原存储用例覆盖1920/1365/390px；备注用例覆盖1365/390px，实际编辑/键盘保存、清空、刷新、独立browser回读、并发CAS、unknown原命令恢复、后续修改不被历史receipt覆盖、授权丢失清屏、会话存储失败零写入。两个定向用例额外覆盖旧草稿刷新后继续编辑、清空，均保留原CAS并在明确409后才允许新版确认。没有调用真实业务数据或PostgreSQL。

保留的RED：新增接口尚未实现；纯空白原文被旧非空校验误拒；未提交草稿刷新后错误采用新remote revision。最后两项均有行为反例并完成最小修复。浏览器fixture曾在pending刚出现时就刷新/核对wire，早于异步请求实际完成；采集HTTP/wire后，改为严格等待明确rejected/unknown并独立确认synthetic写入真实commit，保留原断言，不用放宽超时或状态掩盖失败。

当前明确未完成：MCP组负责共享API路由、schema/client/readback、Skill及独立0026 operation登记；原0019/0021保持不变，缺操作登记应failclosed。共享discovery仍5对6的严格RED另行保留。完整生产webpack build及同产物检查待串行资源槽；独立审查、普通feature PR/main集成、原CI/CD/Native+HTTPS和真实跨设备读回尚未完成。本地MemoryPort/Chrome证据不称真实PG、生产可用或本人体验验收。

独立审查对固定9987发现一个Important：旧草稿刷新后再次input会采用最新remote revision；实际浏览器证明另一端新备注可能被覆盖。编辑与清空两条真实浏览器反例均先RED（提交新版3而原基线2），最小修正后两条均提交原版本2，保留服务器新备注并显示冲突；只有明确拒绝后的确认按钮才改基线。9987完整webpack与44+2项同产物closed检查已通过，作为历史保留；修正后的源码须重新完整构建，不能复用旧绿灯。
