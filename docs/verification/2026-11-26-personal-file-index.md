# LO-FILES-001 本人文件索引只读切片

沿 [Issue #16](https://github.com/Nirvana-Chow/lifeos-app/issues/16) 和原 [OpenSpec 10.2](../../openspec/changes/personal-agent-foundation/tasks.md) 延续文件地图。固定基线为 `59ef4dcbb9a7a8c6c2df955ec02802e544b3807e`。

## 运行合同

- `/personal/files` 使用原个人工作台与当前本人会话。索引项可用 `?id=<稳定索引 UUID>` 定位。打开项目时重新通过 GET 核对索引身份及项目三元组，再进入既有本人项目详情。显示文件位置文字，无文件打开或抓取操作。
- 运行时可通过部署端显式配置 `LIFEOS_PERSONAL_FILE_INDEX_MANIFEST` 接收已经授权且筛过字段的只读元数据。未配置时显示未接入；配置不合格、空间不符、存储故障或无数据均有独立状态。候选未配置正式来源。
- 清单 JSON 对象含 `version:1`、当前 `ownerId`、当前 `spaceId` 和 `entries`。最多 64 KiB 和 80 项。每项含 UUID `id`、UUID `sourceId`、正整数 `revision`、`title`、可空的 `project:{id,sourceId,revision}`，以及 `location`。位置状态 `unverified` 使用可空展示文字，`example` 使用示例文字，`verified` 还需附 UTC `verifiedAt`。位置文字仅作页面显示；提供者负责授权及核验，勿提交未授权的机器路径和业务正文。
- 所有读取先核本人及项目访问，再核空间、项目来源和精确修订，返回前重新校验会话。示例不可打开。只用原项目读取，无新入录、Agent 授权、附件、文件系统扫描、数据迁移或存储审核变更。

测试使用隔离文件索引元数据和合成项目。启用浏览器测试需 `RUN_PERSONAL_FILE_INDEX_BROWSER_TESTS=1` 与隔离 Chromium；默认测试不会拉取正式文件或访问文件字节。
