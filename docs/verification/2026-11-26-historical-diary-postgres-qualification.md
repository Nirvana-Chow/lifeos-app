# 合成历史日记的原生 PostgreSQL 资格

LO-DATA-001（#10，现有 OpenSpec 4.1–4.2）沿用 #242 固定稿的合成包、日期、命名空间、原始 ID、确定性记录 ID 和预览摘要。原文仍按原字节保留，缺失的原始标题只生成明确标识的展示标签。超过现有 journal 正文上限的内容在预览标为不可导入，禁止截断。新版本和不同内容继续作为冲突，保留已登记原件。

选择写入只在显式启用的 PostgreSQL 测试夹具中执行。它要求合成 owner/space、当前授权状态及明确登记的包摘要，且通过现有受限仓库事务写入原生 source、record、history 和 command。记录和批次回执在同一事务提交。现有 journal GET、history 和日记快照通过独立连接读回，确认日期、正文、来源 ID、路径、版本和摘要。普通 journal 请求无权提交迁移来源字段。

资格命令使用一次性、仅监听 loopback 的 PostgreSQL 17 空库。夹具先证明数据库名称、版本、命名空间为空，再应用现有 core SQL，并以 NOSUPERUSER、NOBYPASSRLS 受限角色接入仓库。测试覆盖导入关闭、缺包批准、异空间、冲突、事务内中断、提交后丢回执、原键恢复、重放零增量、换键旧预览被拒和未设置 owner 的 RLS。

    RUN_HISTORICAL_DIARY_PG=1 LIFEOS_HISTORICAL_DIARY_FIXTURE_PORT=<loopback-port> \
      node --test test/historical-diary-postgres.integration.test.ts

生产没有挂载历史迁移写入入口。真实迁移仍需只读盘点和批准固定来源包、映射缺字段与版本更正规则、写入与密钥边界、独立备份/恢复和针对真实样本逐项回读。合成夹具无法完成这些门禁。
