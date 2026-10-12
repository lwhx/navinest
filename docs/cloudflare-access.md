# 后台登录与 Cloudflare Access

## 开发期间：站内登录一次

用户要求暂时简化复杂登录。`wrangler.jsonc` 已配置 `ADMIN_AUTH_MODE=session`：当前同时配置 `GITHUB_LOGIN_ENABLED=false`，管理员使用现有 `/login` 的账号密码登录，站内会话可直接进入 `/admin`，不再由应用要求额外 Access 邮箱验证码。后台页面未登录时转到站内登录页，成功后返回原后台页面；管理 API 和未登录 POST 仍返回 `401`，普通账号返回 `403`。

应用每次请求从 D1 验证会话摘要、有效期、账号 active 状态和当前 admin 角色；退出、撤销、过期、停用或降级立即影响后续后台请求。此模式不信任 Access 邮箱/JWT 请求头，前台注册也不会自动获得管理员角色。当前会话沿用 Secure、HttpOnly、SameSite=Lax Cookie。回跳仅接受站内 `/admin` 页面，GitHub 暂停期间不启动 OAuth；恢复后回跳通过 10 分钟、限定 OAuth 路径的 HttpOnly Cookie 传递，正常前台登录仍回首页。

| 配置                      | 后台应用要求                          |
| ------------------------- | ------------------------------------- |
| `ADMIN_AUTH_MODE=session` | 有效的站内 active admin 会话          |
| `ADMIN_AUTH_MODE=access`  | Access 验证及同邮箱的 D1 active admin |
| 未配置或其他值            | 沿用 Access 模式                      |

### GitHub 登录临时关闭

- `GITHUB_LOGIN_ENABLED=false`（或未配置）：隐藏登录页按钮与用户中心的第三方区块；授权和回调接口均返回 503 中文提示，不创建新 OAuth 会话。已有登录会话不被注销，OAuth 数据和绑定保留。
- 以后设置 `GITHUB_LOGIN_ENABLED=true` 并部署，恢复原入口及回调；保留现有 Client ID/Secret 配置，原 state 验证、安全 Cookie 和 admin 回跳继续生效。此开关不替代注册或管理员权限开关。
- 部署前先确认至少一名 active admin 具备已知有效密码。只有 GitHub 绑定、没有密码的账号需要管理员在“后台 → 用户”设置密码，当前“账号安全”页只支持修改已有密码；不要在无法用密码重新登录时主动退出唯一可用的会话。此轮不查询或重置正式密码，不删绑定。
- 仓库关闭配置已经准备，正式站须部署最新 Worker 后才生效，不能仅凭 PR 合并认定线上关闭完成。

### 正式站切换顺序（待操作）

仓库配置与 Cloudflare 边缘策略是独立的。本轮没有部署 Worker、修改 Access 应用或管理员角色；截至切换前匿名探测仍进入邮箱验证码页面。因此 PR 合并不代表线上验证码已经关闭。

1. 先确认管理员密码可用，再部署本轮代码，确认实际 Worker 环境使用 `ADMIN_AUTH_MODE=session` 与 `GITHUB_LOGIN_ENABLED=false`，数据库会话字段已经修复。保持 Access 策略，先由管理员经过现有 Access 打开后台：未登录站内账号时应转 `/login?returnTo=...`；站内管理员登录后可进入原后台页。这一步确认应用内守卫与真实管理员账号可用。
2. 在 Cloudflare Zero Trust 的 Access Applications 中找到覆盖 `nss.whks.de/admin*` 与 `nss.whks.de/api/admin/*` 的后台应用，保存原 Allow 策略内容；仅给这些后台路径添加临时 `Bypass / Include / Everyone` 策略，名称可用“开发期站内管理员登录”。保留原 Allow 策略以便恢复，不更改其他应用、全站保护、域名或数据库。若两条路径分属不同应用，需要分别处理。Bypass 会暂停这些路径的 Access 认证与 Access 请求日志，应用内 D1 会话及角色检查继续负责授权。[Cloudflare 官方策略说明](https://developers.cloudflare.com/cloudflare-one/access-controls/policies/#bypass)
3. 无痕窗口确认匿名 `/admin` 转站内登录页，匿名 `/api/admin/users` 返回 `401`；普通用户无法进入后台，真实 active admin 可读取和修改原模块，退出后重新要求登录。异常时立即移除临时 Bypass，恢复原 Access 保护。

**项目完成后恢复：先移除临时 Bypass，确认两个路径重新由 Access 拦截；再将 `ADMIN_AUTH_MODE` 改为 `access` 并部署。** 不要在边缘仍 Bypass 时切回依赖 Access 请求头的模式，也不要回滚到旧守卫后继续保留 Bypass。

## Access 模式

NaviNest 在 Access 模式使用两层后台访问控制：

1. Cloudflare Access 在边缘完成身份认证，并注入用户邮箱与 JWT assertion。
2. NaviNest 使用 Access 邮箱查询 D1，只允许 `users.role = 'admin'` 且 `users.status = 'active'` 的用户访问。

### 切换前的后台登录入口（2026-10-12 实测）

入口：<https://nss.whks.de/admin>。2026-10-12 匿名实测 `/admin` 与 `/api/admin/users` 均重定向至 Access；后台登录页显示 “Log in to NaviNest Admin”，当前提供邮箱验证码登录。

1. 打开后台地址，在 Email 中填写 Access 策略允许的管理员邮箱。
2. 选择 “Send login code”，在邮件中接收验证码并完成验证。
3. Access 验证后，应用仍要求该邮箱对应 D1 用户的角色为 `admin`、状态为 `active`。

在 `access` 模式，前台 `/login` 的 GitHub/密码会话与后台 Access 会话职责独立。项目历史记录的管理员邮箱为 `whuil574@gmail.com`，当前实际 Allow 策略以 Cloudflare 配置为准；本轮没有变更策略或管理员角色。

### Access 应用配置

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

如果以后需要在没有 Access 代理的环境中独立验证 Access 身份，应增加 Access JWKS 签名和 audience 校验，不能只信任请求头。站内 session 模式通过数据库会话验证身份，不使用 Access 请求头。

### Access 管理员配置

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

## Access 模式上线检查

- Access 应用覆盖 `/admin*` 与 `/api/admin/*`
- 所有后台可达主机名都受保护
- D1 中存在对应邮箱的 active admin 用户
- 未授权请求分别返回预期的 `401` 或 `403`
- 后台页面包含 `noindex,nofollow`
- 前台路由不依赖 Access 请求头
