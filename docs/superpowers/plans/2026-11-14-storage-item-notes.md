# 存储条目备注执行切片

2026-11-14 · EXEC-STORAGE-NOTES-001 / LO-FILES-001 / Issue #41，沿 unified-business-ui 原 owner-storage 3.1/3.2；业务需求/进度仍在原受控需求池。本文件只记录工程合同，不复制私人清单或业务状态。

设计采用原 storageReview JSON 中独立 `notes?:[{id,note}]`，沿原 deterministic owner-space record、单条目服务端 CAS、幂等收据、授权 fence 和 write permit。旧无 notes 的记录保持兼容；原文最多8000字符，不trim，空字符串明确清空。protected/processed/父目录可备注，决定和状态保留；新清单拒绝移除/替换仍有备注的对象。相比把备注混进不可变 checklist 或只存本机，本方案能跨端回读并保留清单版本语义，不需数据库迁移。

实现顺序：先复现单项保存/清空/冲突/原文回读和新清单保留行为；补domain/service/ownerHTTP与Agent专属导出；UI沿当前原生textarea+明确保存和原会话恢复机制；MCP组独占共享registry/routes/contracts/client/Skill接线。新operation `updateStorageReviewNote`，`PATCH /v1/storage-reviews/{id}/notes`，原storage-review read+write scopes与原就绪条件，不新增grant权限。

浏览器未提交备注用同owner-space会话存储保留；unknown保存完整原command/key，重读和显式恢复前不自动重发或换key。CAS明确拒绝后才经本人按钮按新revision再确认；旧决定恢复规则不削弱。新清单或退出不能静默丢失草稿。只写备注，不访问文件字节、扫描、云上传或物理删除。

复用已审静态HTML route/owner端点与现有组件语义，未加依赖。原生textarea有显式label、maxlength、键盘保存按钮及独立已保存/草稿提示；保留CSP hash与private/no-store。[HTML textarea规则](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/textarea)和[Next route handler缓存说明](https://nextjs.org/docs/app/getting-started/route-handlers)只校准原生行为，不换栈。

验证：聚焦domain/service/ownerHTTP/Agent/MCP回归和类型检查；当前实际route+保存/清空/刷新/独立浏览器/CAS/unknown恢复；排队实际生产webpack build+同产物default-closed；独立审查后普通feature PR，合并前核最新main和single-site发布owner，沿原CI/CD/HTTPS读回，发布与本人体验分开。只借固定720bcc依赖，不安装或改锁。实际PG/生产业务写入如未执行须明确保留缺口。
