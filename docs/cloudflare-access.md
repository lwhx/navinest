# Cloudflare Access 后台保护

NaviNest 使用两层后台访问控制：

1. Cloudflare Access 在边缘完成身份认证，并注入用户邮箱与 JWT assertion。
2. NaviNest 使用 Access 邮箱查询 D1，只允许 `users.role = 'admin'` 且 `users.status = 'active'` 的用户访问。

## 当前后台登录入口

入口：<https://nss.whks.de/admin>。2026-10-12 匿名实测 `/admin` 与 `/api/admin/users` 均重定向至 Access；后台登录页显示 “Log in to NaviNest Admin”，当前提供邮箱验证码登录。

1. 打开后台地址，在 Email 中填写 Access 策略允许的管理员邮箱。
2. 选择 “Send login code”，在邮件中接收验证码并完成验证。
3. Access 验证后，应用仍要求该邮箱对应 D1 用户的角色为 `admin`、状态为 `active`。

前台 `/login` 的 GitHub/密码会话与后台 Access 会话职责独立。项目历史记录的管理员邮箱为 `whuil574@gmail.com`，当前实际 Allow 策略以 Cloudflare 配置为准；本轮没有变更策略或管理员角色。

## Access 应用配置

在 Cloudflare Zero Trust 中创建 Self-hosted application，并保护以下路径：

- `nss.whks.de/admin*`
- `nss.whks.de/api/admin/*`

策略应只允许实际管理员身份。建议优先使用精确邮箱或受控身份提供商群组，不要使用公开域名规则。

后台守卫要求 Cloudflare 提供以下请求头：

- `Cf-Access-Authenticated-User-Email`
- `Cf-Access-Jwt-Assertion`

应用只检查 assertion 是否存在，JWT 签名和 audience 验证由前置 Cloudflare Access 承担。因此必须满足：

- 所有承载后台的自定义域名都配置相同的 Access 保护。
- 禁用未受保护的 `workers.dev` 和 preview URL，或为它们配置等价的 Access 应用。
- 不要将 Worker 暴露在可绕过 Access 的其他路由上。

如果以后需要让 Worker 在没有 Access 代理的环境中独立验证身份，应增加 Access JWKS 签名和 audience 校验，不能只信任请求头。

## 创建应用内管理员

Access 身份通过后，邮箱还必须存在于 D1 `users` 表。创建管理员示例：

```sql
INSERT INTO users (email, username, display_name, role, status)
VALUES ('admin@example.com', 'admin', 'Administrator', 'admin', 'active');
```

邮箱匹配不区分大小写。以下情况会拒绝访问：

- 缺少 Access 邮箱或 assertion：`401`
- D1 用户不存在、角色不是 `admin` 或状态不是 `active`：`403`
- 部署环境缺少 D1 binding：`503`

## 本地开发

本地 Vite 开发服务器没有 Cloudflare Access 和 D1 platform。仅当以下条件同时成立时，守卫会使用只读本地管理员身份：

- SvelteKit 没有 Cloudflare `platform`
- 主机名为 `127.0.0.1`、`localhost` 或 `[::1]`

本地后台显示 fallback 示例数据，不会伪装成已写入 D1。部署环境不会启用该绕过。

本地入口：

```text
http://127.0.0.1:5173/admin
```

## 上线检查

- Access 应用覆盖 `/admin*` 与 `/api/admin/*`
- 所有后台可达主机名都受保护
- D1 中存在对应邮箱的 active admin 用户
- 未授权请求分别返回预期的 `401` 或 `403`
- 后台页面包含 `noindex,nofollow`
- 前台路由不依赖 Access 请求头
