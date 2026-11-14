# 存储条目备注验证

2026-11-14 · LO-FILES-001 / EXEC-STORAGE-NOTES-001 · 原 owner-storage / unified-business-ui 3.1/3.2 / Issue #41。

备注与处理要求保存到原owner-space storageReview JSON的独立notes字段。旧清单兼容；决定、protected/processed状态和稳定身份独立保留；新清单拒绝移除或替换仍有备注的对象。原文不trim，最多8000字符，空字符串明确清空，仍受原128KiB UTF8、CAS、身份锁、授权fence和幂等收据约束。没有扫描、上传或物理文件处理。

已有证据分别为：

- 核心59项聚焦检查、4条实际Chrome合成路由流程（原1920/1365/390px，新1365/390px），零失败/跳过，覆盖原文保存、清空、刷新、独立browser、旧草稿继续编辑与清空、明确409重新确认、unknown原key恢复、后来内容不被历史receipt覆盖、撤权清屏和本机保留失败零写入。
- 共享Agent/MCP接线合入后76项聚焦检查与TypeScript通过，官方SDK的2026/2025两种协议均实际调用新增note的保存/清空与独立GET。全原Node suite最终2311P/0F/93项显式opt-in跳过；跳过不算集成验收。新目录测试保留原53/57项兼容case，另加54/58项新目录，完整JSON目录为62；精确ID、schema、scope、工程调用拒绝和逐次授权刷新断言保留。
- marked隔离PostgreSQL17.11实际执行0026注册与原grant fence：1P/0F/0skip，验证双registry/default-off/缺approval与错role拒绝/明确启用fixture后成功/撤权和原grant不变。原0019/0021没有改写。
- 同合格fixture执行原`REAL PostgreSQL restricted-role/RLS` outercase：1P/0F/0skip/stderr0。原`verifyStorageReviewPersistence`直接调用和case数不变，新增断言实际核对CRLF原文、保护项备注、独立restricted pool回读、CAS、历史receipt、清空、决定保留及已备注对象不丢。

Root对核心修正479的定向独审C0/I0/M0通过，并独立运行浏览器反例闭合。共享1ddc4a9及3d744e9由未修改其产品文件的Notes owner有界技术复核；发现的Skill最后句Minor已由原writer修正并同步archive，没有改scope或guard。完整生产webpack与同产物检查须在最后固定组合源码上运行，PR记录真实SHA/buildId；9987和479的历史构建不替代共享接线后的新树。

保留RED：纯空白原文误拒、草稿刷新/继续input/清空时基线被替换，以及共享新增操作后旧精确目录oracle未包含note。并发编辑和清空均先实际Chrome RED，再最小修为保留原checklistRevision/expectedRevision，只有明确409后的按钮才改基线。原unknown/撤权恢复回归保持。浏览器fixture曾早于异步完成就检查wire；已以明确rejected/unknown及独立确认synthetic commit作为更严格完成条件。

默认权限仍关闭：0026只登记新操作且`enabled=false`，实际Agent/MCP依赖当前DB目录、原scope、grant、owner/MFA与write permit；公开HTTP业务MCP不含工程claim或事件执行。普通PR/main原CI、单writer的既有Native+HTTPS生产读回、真实跨设备与本人体验另行取证，本地合成/PG证据不替代这些结果。
