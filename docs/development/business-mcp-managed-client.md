# ChatGPT 的固定 OAuth 客户端设置

这是原 LO-AGENT-001 / OpenSpec11.1 的账号设置入口。源码、本地合成资格、实际发布和本人安装验收分别记录；本文不表示生产 OAuth 已启用，也不创建或扩大业务授权。

## 受审接口

- 页面：`/account/mcp`，只供当前本人网页登录并完成 MFA 后使用。
- 设置 API：`GET/POST /api/platform/business-mcp/client`。仅本人 Cookie+当前 MFA、固定来源；API Key、OAuth Bearer 和混合 Bearer 请求不能管理客户端。
- POST 只接受 `{callback, commandId}`。callback 必须是这次 ChatGPT 页面显示的 `https://chatgpt.com/connector/oauth/` 加 8–128 个字母、数字、下划线或短横线；不接受端口、查询、片段、凭据或转义路径。commandId 为原 UUID。
- 服务端只注册固定标识 `https://lifeos.nirvanachow.com/oauth/clients/chatgpt`，使用官方 Better Auth1.7.23 `generateClientId` 和 server-only `adminCreateOAuthClient`。固定 public/none、S256、code+refresh、现有批准 scopes、固定 MCP resource、`skipConsent=false`。
- 相同 UUID 和完整相同配置仅独立读回；不同 UUID、callback、scope、metadata、managed 来源或 resource link 返回409。没有自动更新、替换、轮换或任意客户端管理入口。

注册和读回复用原 owner recovery 锁，覆盖当前 MFA 检查、当前 readiness、SDK 事务和结果核对。官方 SDK 负责 client/resource link 的原子创建，固定 clientId 的数据库唯一约束负责跨进程仲裁。锁只占用一条连接，实际 runtime max3 的另外两条供原认证和 SDK 使用；新设置代码不递归 readiness、不增加锁协议。

SDK `getOAuthClient` 对缺失 HTTPS ID 会进入 CIMD，并且省略 managed 来源与 resource links。设置 API 因此用官方 adapter 的固定 model/固定 ID、明确非秘密字段和有界 link 查询独立读回；缺失直接判 absent，不发起发现。不能选择任意 model、ID 或 select，不读取 clientSecret/privateKey/token，不返回原始 SDK 对象。GET 仅投影本人需要的固定配置。

本方 HTTPS client ID 是已注册标识，不是伪造的 ChatGPT CIMD 文档；其 URL 不需要提供元数据页面。managed 记录的 `clientDiscoveryId=null` 使官方 provider 直接读取原注册记录；none 不依赖外部客户端 JWKS。原 CIMD 显式 clientId 和 private_key_jwt 路径保持可用，DCR、client_credentials、device grant、通用 adminHTTP 仍关闭。

## 本人的完整操作

技术前置由发布负责人完成：固定 main 的原 CI、原私有自动发布与 Native+HTTPS 读回；合格 schema、runtime/control 一致、当前批准原 grant/scopes、restricted readiness、旧 Key/native/MFA 基线。不能仅因页面源码存在而跳过这些门禁。

1. 打开 `https://lifeos.nirvanachow.com/account/mcp`，使用原账号登录并完成两步验证。页面先展示现有配置；已有配置时不会出现新建表单。
2. 打开 ChatGPT → 插件 → 添加 → 自定义 MCP，MCP URL 填 `https://lifeos.nirvanachow.com/api/platform/mcp`。在高级 OAuth 中选择「用户自定义 OAuth 客户端」，Token 认证方式选 `none`；保留当前这份连接草稿。
3. 将这份 ChatGPT 草稿显示的完整回调地址复制到 LifeOS 页面，点击「保存连接配置」。这里只保存配置，尚未授予业务访问。若结果未确认，保留本页，先点击「核对保存结果」；页面保留原 callback/UUID，显式重试仍使用原请求。不要另建请求或换草稿来猜结果。
4. 回到同一份 ChatGPT 草稿，填写 LifeOS 页面给出的值：
   - 客户端 ID：`https://lifeos.nirvanachow.com/oauth/clients/chatgpt`
   - 授权地址：`https://lifeos.nirvanachow.com/api/platform/auth/oauth2/authorize`
   - Token 地址：`https://lifeos.nirvanachow.com/api/platform/auth/oauth2/token`
   - Resource/MCP 地址：`https://lifeos.nirvanachow.com/api/platform/mcp`
   - Scopes：使用 LifeOS 页面当前显示的完整值，不自行增加；Token 认证为 `none`，PKCE 为 `S256`，不填 Key 或 client secret。
5. 完成 ChatGPT 连接步骤，在 LifeOS 再核当前本人身份/MFA、实际请求范围和原业务授权后同意连接。若回调或配置已改变而出现409，保留原请求与当前草稿，交发布负责人核对；本页不会覆盖或扩大权限。
6. 连接后先只查询，再明确要求保存本人提供的真实内容、更新同一 ID，并独立 GET 核对。真手机重复必要操作，关闭 Mac 后继续同样验证；这些实际验收不能由合成页面、桌面360px或 SDK 测试替代。

客户端配置本身没有业务权。后续有效权限仍是当前 token、client/consent/binding、原 grant、readiness 与 business policy 的交集；原 API Key 不会因此自动成为 OAuth business 授权。普通网页登录退出仅结束网页会话；撤销连接、原 grant 到期/收权、本人身份或 MFA 失效必须即时阻断委托。

## 未知结果与回滚

原 UUID 作为非秘密注册 metadata 保存，响应仅在独立读回完整匹配后报告成功。SDK 结果丢失不会自动再次创建；部分或漂移配置保持冲突，不自动补 link 或更新客户端。浏览器仅在会话存储保留最小 callback/UUID；存储不可用时保留当前页面的原请求和离开保护，不保存 Key、token、Cookie 或业务内容。

生产回滚仍走原受审流程：先关闭 OAuth app flag，并在原 gate 下禁用 control，核旧委托被拒且原 Key/native/MFA 有效。保留 schema、client 配置、binding、SHA ledger 和命令审计，不 DROP、不导出凭据、不替换原 grant；源与依赖回退通过原发布链。新设置入口不加入业务 MCP 能力目录，不修改文件 Skill 或其 releaseSequence。
