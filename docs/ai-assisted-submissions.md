# AI辅助投稿：架构与安全边界

## 用户流程

1. 登录用户输入公开网页URL。
2. 服务端执行URL、DNS、重定向、响应类型、大小和超时检查。
3. 提取网页标题、描述、站点名和可读正文摘要。
4. 若存在已经测试并启用的OpenAI兼容服务，则生成简洁标题、简介、补充说明和标签建议。
5. 用户逐项采用或修改建议；AI不会自动覆盖非空字段，也不会自动提交。
6. 投稿保存用户最终值、网页快照和AI候选值，等待管理员审核。
7. 管理员对比三方证据，选择正式分类和已有标签后发布或拒绝。

## OpenAI兼容服务

- 调用`POST {baseUrl}/chat/completions`。
- 默认使用`response_format={"type":"json_object"}`；服务返回400/422时自动降级为普通Chat Completions并继续解析严格JSON。
- 输出字段有服务端长度、数量和类型限制。
- 配置修改Base URL、模型或API Key后会自动停用并清除测试状态。
- 服务必须通过真实连接和结构化输出测试后，管理员才能显式启用。

## 密钥保护

- D1仅保存AES-GCM密文、随机IV和末4位提示。
- 32字节加密主密钥位于Cloudflare Secret `AI_CONFIG_ENCRYPTION_KEY`。
- 后台Loader、表单和API不回传密文或明文Key。
- 编辑配置时API Key留空表示保留；修改Key会重新加密并要求重新测试。
- 生产备份只记录Secret名称，不记录主密钥值。

## 网页抓取和SSRF

纯Cloudflare Worker无法将任意第三方域名的HTTP连接固定到预解析IP，因此当前方案是折中防护，不能完全消除DNS rebinding/TOCTOU理论风险。

当前防护：

- 仅HTTP/HTTPS和标准80/443端口；
- 拒绝URL凭据、localhost、私网、链路本地、保留和特殊用途IPv4/IPv6；
- 通过DNS-over-HTTPS检查全部A/AAAA结果；
- 每个重定向目标重新执行同样检查；
- 手工重定向，限制跳转次数；
- 仅接收HTML/XHTML；
- 读取字节、提取正文和请求时间均有限制；
- 不转发用户Cookie、Authorization或浏览器请求头；
- 自定义AI Base URL在实际出站前也执行公网DNS检查。

如果未来Worker接入私网Service Binding/VPC、处理高敏感数据，或需要严格消除DNS重绑定，应把抓取迁移到具备DNS解析结果固定、出站ACL和网络隔离的独立Fetcher服务。

## Prompt Injection边界

- 网页正文永远作为`<untrusted_webpage>`不可信数据传给模型。
- 系统消息明确禁止执行网页中的指令。
- AI无工具调用、无数据库访问、无Cloudflare凭据，也不能直接发布内容。
- 模型输出只按白名单JSON解析；Markdown围栏可剥离，其他自由文本或缺字段结果拒绝。
- AI结果必须由用户确认并经过管理员审核。

## 限流和审计

- 同一用户两次智能获取至少间隔5秒；
- 每个用户每10分钟最多10次；
- D1仅记录用户ID、动作、Provider ID、成功状态和错误类型；
- 不记录API Key、网页正文、模型完整响应或Authorization头。

## 降级策略

- 未配置AI时仍返回网页原始标题、描述和正文摘要；
- AI故障不会阻止用户手动投稿；
- 抓取失败时表单保留手动填写能力；
- 审核发布继续使用现有服务端分类、标签、Slug、媒体和关系校验。

## 迁移与初始数据

- `migrations/`只允许`NNNN_name.sql`编号迁移，Wrangler会把目录中的每个SQL视为生产迁移。
- 初始演示数据位于`seeds/initial.sql`，只能在新建空数据库时显式执行，不能随生产迁移自动运行。
- 备份会同时收录编号迁移和Seed，但两者在Manifest中使用不同目录。
