# NaviNest 开发进度

更新时间：2026-07-13

## 当前阶段

基础功能阶段2至阶段8已完成；产品化完成度尚未达到一为导航。当前进入“一为导航对标重构”，以 `https://nav.iowen.cn/` 网页效果为主、`D:\db\54\onenav` 源码结构为辅，优先重做首页视觉、信息密度和交互。

NaviNest 已完成正式部署、认证与用户中心、投稿审核、排行榜、热榜、SEO、JSON备份恢复、缓存及错误/空状态优化；这些能力作为重构底座继续保留。

## 已完成

- 新建项目目录：`D:\db\54\navinest`
- 保留 OneNav 源码目录作为参考，不在其目录内开发
- 确定项目名称：
  - 英文名：`NaviNest`
  - 中文名：`导航巢`
  - 域名：`nss.whks.de`
  - 项目代号：`navinest`
- 编写正式开发大纲：`docs/development-outline.md`
- 初始化 SvelteKit 项目
- 使用 TypeScript
- 接入 Tailwind CSS
- 接入 ESLint
- 接入 Prettier
- 接入 Vitest
- 接入 Cloudflare adapter
- 新增 Cloudflare 绑定占位：
  - `DB`：D1
  - `FILES`：R2
  - `CACHE`：KV
  - `ASSETS`：静态资源
- 新增环境变量示例：`.env.example`
- 新增 D1 初始数据库结构：`migrations/0001_initial.sql`
- 新增 D1 seed 数据：`migrations/seed.sql`
- 新增 Cloudflare Env 类型声明：`src/cloudflare-env.d.ts`
- 新增 NaviNest 配置文件：`src/lib/config.ts`
- 新增首页 mock 数据：`src/lib/data/navigation.ts`
- 替换默认 SvelteKit 欢迎页为 NaviNest 首页原型
- 新增基础占位路由：
  - `/hotnews`
  - `/rankings`
  - `/login`
  - `/search`
  - `/go`
  - `/categories/[slug]`
- 更新 `README.md`
- 更新 `robots.txt`，加入 sitemap 地址
- 新增核心 TypeScript 类型：
  - `Category`
  - `Tag`
  - `Item`
  - `ItemMeta`
  - `SearchEngine`
  - `HomeModule`
- 新增 D1 数据访问入口和绑定检查
- 新增分类查询服务，支持内容类型和可见性过滤
- 新增内容查询服务，支持：
  - 内容类型过滤
  - 分类过滤
  - 关键词查询
  - 分页
  - 标签和 `item_meta` 聚合映射
- 新增搜索源查询服务
- 新增首页服务端加载：
  - D1 可用时并行读取分类、内容和搜索源
  - D1 缺失或首页查询失败时使用 mock fallback
  - 详情页尚未实现前，仅展示具备外部目标 URL 的内容
- 新增基础只读 API：
  - `GET /api/categories`
  - `GET /api/items`
  - `GET /api/search-engines`
- 新增查询服务单元测试
- 首页改为按分类分组展示内容
- 首页分类导航与当前滚动分区联动
- 桌面端保留固定分类侧栏，移动端使用顶部横向分类导航
- 提取可复用导航卡片和内容结果组件
- 新增标签查询服务和内容标签过滤
- 站内搜索页接入 D1 内容查询，支持本地 fallback
- 分类页接入 D1 分类及内容查询，支持本地 fallback 和 404
- 新增标签页，接入 D1 标签及内容查询，支持本地 fallback 和 404
- 增加搜索、分类和标签页的结果状态与空状态
- 修复移动端 CSS Grid 最小内容宽度导致的页面横向溢出
- 搜索源标签在窄屏下保持单行并独立横向滚动
- 内容标签关系升级为同时保留名称和真实 slug
- 新增按内容类型和 slug 查询单条已发布内容
- 新增统一详情视图模型和详情组件
- 新增五类内容详情路由：
  - `/sites/[slug]`
  - `/posts/[slug]`
  - `/apps/[slug]`
  - `/books/[slug]`
  - `/bulletins/[slug]`
- 导航卡片改为先进入站内详情页，再由详情页进入安全跳转
- 详情页支持分类、标签、扩展字段、正文和外部访问入口
- 外链跳转改为服务端校验，仅允许无账号凭据的公网 HTTP/HTTPS 地址
- 外链校验会拦截控制字符、本机名、私网地址、保留地址和非 Web 协议
- 新增全局暗色模式开关、系统偏好初始化和 `localStorage` 持久化
- 页面语言声明更新为 `zh-CN`
- 卡片标签可独立进入标签页，整卡详情链接与标签链接保持分层可访问
- 新增全局 404/错误页，非 404 错误不暴露内部异常内容
- 新增客户端路由切换进度条，并尊重减少动画偏好
- 详情页新增 canonical、Open Graph、Twitter Card 和 JSON-LD
- 新增文章与公告 fallback 示例
- D1 seed 扩充为 7 个分类、8 条内容和 7 个标签，并覆盖五种内容类型
- 新增 Cloudflare Access 后台保护配置说明
- 禁用 `workers.dev` 和 preview URL，避免绕过 Cloudflare Access
- 新增 `/admin*` 与 `/api/admin*` 服务端管理员守卫
- 管理员身份使用 Cloudflare Access 请求头和 D1 active admin 角色双重授权
- 本地管理员绕过严格限制为无 Cloudflare platform 的 loopback 开发环境
- 新增响应式后台布局、概览页和以下只读管理列表：
  - `/admin/items`
  - `/admin/categories`
  - `/admin/tags`
- 新增内容、分类、标签统一后台输入校验：
  - 内容类型、状态和可见性白名单
  - slug、文本长度、整数、布尔值和关联 ID 校验
  - 内容扩展字段按类型限制
  - 外链扩展字段复用公网 HTTP/HTTPS 安全校验
- 新增内容、分类、标签写入服务，支持创建、更新和删除
- 内容写入同步 `item_meta` 和 `item_tags`，更新操作使用 D1 batch
- 新增跨表数据完整性保护：
  - 分类、标签和内容类型必须一致
  - 分类父子关系不能形成环路
  - 已被引用的分类和标签不能直接改变内容类型
- 新增后台授权、输入校验和写入服务测试
- 内容、分类、标签后台列表升级为同页 CRUD 工作流：
  - `?create=1` 打开新增表单
  - `?edit={id}` 打开编辑表单
  - 服务端 form actions 完成新增、更新和删除
  - 本地 fallback 保持只读，不显示无效写入入口
- 内容表单支持分类、标签、状态、可见性、排序、推荐状态和正文
- 内容表单按网址、APP/资源、书籍/影视类型显示对应扩展字段
- 新增内容、分类、标签管理 API：
  - `POST /api/admin/items`
  - `PATCH /api/admin/items/:id`
  - `DELETE /api/admin/items/:id`
  - `POST /api/admin/categories`
  - `PATCH /api/admin/categories/:id`
  - `DELETE /api/admin/categories/:id`
  - `POST /api/admin/tags`
  - `PATCH /api/admin/tags/:id`
  - `DELETE /api/admin/tags/:id`
- 页面 actions 与 JSON API 复用相同输入校验和写入服务
- 管理写入统一返回字段错误、`400`、`404`、`409`、`503` 和 `500` 状态
- 新增后台表单、编辑区、行操作、暗色模式和移动端样式
- 新增首页模块后台管理，支持六种模块类型、JSON 对象配置、排序和启用状态
- 新增搜索源后台管理，URL 模板必须包含 `{query}` 并指向公网 HTTP/HTTPS 地址
- 新增首页模块与搜索源的创建、更新、删除管理 API
- 新增 R2 文件管理：
  - `/admin/files` 上传、索引列表和删除
  - `POST /api/admin/files` 与 `DELETE /api/admin/files/:id`
  - 限制图片 MIME 类型、空文件和 5 MiB 大小上限
  - 使用日期与 UUID 生成不透明对象键
  - D1 索引失败时补偿删除 R2 对象
  - 被内容封面或图标引用的文件禁止删除
- 新增 R2 文件流程文档：`docs/r2-files.md`
- 创建真实 Cloudflare 资源并更新绑定：
  - D1：`navinest`
  - R2：`navinest-files`
  - KV：`CACHE`
- 在远端 D1 成功执行初始 schema 与 seed
- 创建首个 active admin：`whuil574@gmail.com`
- Worker 已部署到自定义域名 `nss.whks.de`
- 线上验证：
  - 首页从真实 D1 渲染七个分类和八条内容
  - 分类、内容和搜索源 API 返回真实 seed 数据
  - 未认证 `/admin` 与 `/api/admin/*` 返回 `401`
- 创建 Cloudflare Access 自托管应用 `NaviNest Admin`：
  - 保护 `nss.whks.de/admin*` 与 `nss.whks.de/api/admin/*`
  - Allow 策略仅允许 `whuil574@gmail.com`
- 使用真实 Access 会话完成线上后台验收：
  - 分类、标签、内容、首页模块和搜索源创建成功
  - 发布内容与启用搜索源可由公开 API 读取
  - PNG 成功写入真实 R2 与 D1 索引并成功删除
  - 临时验收数据已全部清理，D1 恢复 seed 基线，R2 临时对象不存在
- 新增普通用户认证基础：
  - `0002_auth_sessions.sql` 增加 D1 Session 与登录尝试表
  - Workers 兼容的分段 PBKDF2-SHA-256 密码哈希，总工作因子 210,000
  - Session 原始令牌仅存 HttpOnly/Secure/SameSite=Lax Cookie，D1 仅存 SHA-256 摘要
  - `POST /api/auth/login`、`POST /api/auth/logout`、`GET /api/auth/me`
  - 登录页接入账号密码认证，用户名和邮箱均可登录
  - 同一账号标识与 IP 连续失败 5 次后锁定 15 分钟
  - 线上验证登录、Session、退出、Cookie 属性与限流均通过，测试数据已清理
- 新增 GitHub OAuth：
  - GitHub OAuth App `NaviNest`，回调地址为 `/api/auth/github/callback`
  - Client ID 为公开 Worker 变量，Client Secret 仅存 Cloudflare Worker secret
  - 随机 32-byte state 使用 HttpOnly/Secure/SameSite=Lax Cookie，回调严格校验
  - 权限范围仅 `read:user user:email`
  - 按 GitHub provider ID 绑定账号，verified email 可绑定已有用户，否则创建普通用户
  - OAuth 成功后复用 D1 Session，伪造 state 返回 `400`
- 新增基础用户中心 `/user`，显示用户名、邮箱、角色、GitHub 绑定和退出入口
- 首页登录入口在已登录状态下显示用户名称
- 使用真实 GitHub 账号 `lwhx` 完成线上授权、账号绑定、Session、首页与用户中心验收
- 新增用户资料编辑：
  - `PATCH /api/user/profile` 支持显示名称、邮箱、头像文件 ID 和封面文件 ID
  - 邮箱格式与唯一性校验，头像/封面文件必须属于当前用户
  - `POST /api/user/files` 使用当前 Session 用户 ID 上传私有 R2 图片
  - 用户中心支持资料保存、头像和封面上传并自动关联
  - 私有 R2 通过所有者限定 API 受控读取，头像和封面可在用户中心直接展示
  - 使用真实用户完成资料修改、PNG 上传和头像关联验收，并恢复原资料、删除 R2 对象与 D1 索引
- 新增收藏与足迹：
  - `PUT/DELETE /api/user/favorites/:itemId` 提供幂等收藏和取消收藏
  - 仅允许收藏与记录 `published + public` 内容，草稿、私有和不存在内容统一拒绝
  - 登录用户访问真实 D1 详情时自动记录最近足迹，匿名访问不写入
  - `0003_user_activity.sql` 清理历史重复足迹并建立 `(user_id,item_id)` 唯一索引
  - 足迹使用 UPSERT 更新最近访问时间，并增加用户时间排序索引
  - 内容详情提供收藏/取消收藏按钮，未登录操作跳转登录
  - 用户中心新增“我的收藏”和“最近浏览”列表
  - 使用真实用户和 GitHub 内容完成收藏、足迹去重、用户中心展示和取消收藏验收，相关数据已清理
- 新增用户自定义导航：
  - 分类支持创建、改名、图标、排序和删除
  - 链接支持创建、编辑、分类、摘要、排序、启停和删除
  - 删除分类后已有链接保留并自动转为未分类
  - 自定义链接复用公网 HTTP/HTTPS 安全校验，拒绝本机、私网、保留地址和凭据 URL
  - 所有查询与写入均按 `user_id` 隔离，跨用户分类引用和修改返回错误
  - `POST/PATCH/DELETE /api/user/navigation` 提供 Session 用户专属 CRUD
  - `0004_custom_navigation.sql` 增加用户排序和分类查询索引
  - 用户中心新增自定义导航管理区，链接通过 `/go` 安全跳转
  - 使用一次性测试 Session 完成线上分类/链接 CRUD、排序、停用、分类删除转未分类和界面渲染验收，数据已清理
- 完成私有用户文件生命周期：
  - `GET /api/user/files/:id` 仅允许文件所有者读取 R2 对象
  - 图片响应设置原始 MIME、`nosniff` 和私有缓存；SVG 强制附件下载
  - `DELETE /api/user/files/:id` 仅允许所有者删除，头像/封面仍引用时返回 `409`
  - 用户中心实际展示头像和封面，替换成功后自动删除旧文件
  - 使用两个一次性 Session 完成本人读取、跨用户拒绝、引用保护、页面展示、替换与孤立删除验收
  - 验收后用户资料恢复为 `blackice`，头像/封面为空，测试文件索引为 0
- 阶段 6 用户投稿链路：
  - `/contribute` 提供网址、文章、应用和书籍影视投稿表单
  - `POST /api/submissions` 强制使用当前 Session 用户，投稿状态固定为 `pending`
  - 公告不开放用户投稿；网址和应用必须填写公网 HTTP/HTTPS 目标
  - 标题、简介、正文和 URL 均有长度与安全校验，客户端审核字段被忽略
  - `/user/submissions` 仅展示当前用户投稿、状态、目标地址与审核意见
  - `0005_submissions.sql` 增加用户投稿列表和后台待审核队列索引
  - 使用两个一次性 Session 验证匿名 `401`、创建 `201`、固定待审核、页面渲染和跨用户隔离，验收数据已清理
- 实现后台投稿审核与发布：
  - `/admin/submissions` 展示 pending 优先的投稿队列和审核表单
  - `PATCH /api/admin/submissions/:id/review` 支持通过发布与拒绝
  - 审核通过复用正式内容校验和 `createItem`，强制发布为 `published + public`
  - 发布成功写回 `target_item_id`、审核人、意见和审核时间；关联失败时补偿删除新内容
  - 拒绝投稿必须填写审核意见，不创建正式内容
  - 非 pending 投稿重复审核返回 `409`
  - 后台路由仍受 Cloudflare Access 保护，匿名请求返回 `302`
  - 服务层通过真实 SQLite 验证通过发布、拒绝、关联和重复审核
  - 通过原生页面级 CDP 复用真实 Access 会话完成线上验收：通过发布返回 `200` 并创建公开内容，拒绝返回 `200`，重复审核返回 `409`
  - 线上公开详情、投稿关联、管理员 ID、审核意见和 `published + public` 状态均已验证，临时投稿和内容已清理
- 完成审核结果消息：
  - 投稿发布或拒绝后自动为投稿用户创建 `submission_review` 站内消息
  - 发布消息包含正式内容 ID、类型和 slug；拒绝消息包含审核意见
  - 消息写入失败时补偿恢复投稿 pending；发布场景同时删除刚创建的正式内容
  - `/user/messages` 仅展示当前用户消息，并提供已发布内容链接
  - `PATCH /api/user/messages/:id/read` 按 `id + user_id` 幂等标记已读，跨用户返回 `404`
  - `0006_messages.sql` 增加用户、已读状态和时间排序索引
  - 真实 Access 审核产生两条未读消息，用户消息页面、跨用户隔离和重复已读均在线通过，验收数据已清理
- 阶段 7 排行榜统计：
  - 真实 D1 公开详情访问自动按 UTC 日历日累计浏览量，匿名与登录访问均计数
  - 首次收藏 `+1`、实际取消 `-1`，重复收藏和重复取消不重复计数；统计失败时补偿恢复收藏关系
  - `stats_daily` 计数使用 UPSERT，负增量最低限制为 0
  - `GET /api/rankings?period=day|week|month|total` 提供日榜、最近 7 日周榜、自然月榜和总榜
  - 综合分数为 `views + favorites × 3 + likes × 2`，同分按收藏、浏览和标题排序
  - `/rankings` 提供周期切换、详情链接及浏览/收藏/点赞/综合分展示
  - `0007_rankings.sql` 增加日期+内容及内容+日期查询索引
  - 在线验证匿名浏览 2 次、幂等收藏计 1、综合分 5、四类榜单与页面渲染；验收统计和收藏已清理
- 阶段 7 热榜系统：
  - 后台 `/admin/hot-sources` 支持 JSON/RSS 热榜源创建、编辑、启停、删除和手动刷新
  - 源 URL 和每一跳重定向均执行公网 HTTP/HTTPS 安全校验，拒绝私网 SSRF
  - 请求头禁止 Authorization、Cookie、Proxy-Authorization 和 X-API-Key 等凭据落库
  - JSON 支持数组路径及标题、URL、热度字段映射；RSS 2.0 与 Atom 自动解析
  - 刷新完整解析成功后才替换 D1 快照，失败保留旧数据；最多保留 100 条
  - `/api/hotnews` 与 `/hotnews` 实时展示缓存快照并设置 `Cache-Control: no-store`
  - 自定义 Cloudflare Worker 包装 SvelteKit fetch，并提供 `scheduled()`；Cron 配置为每天北京时间09:15（UTC 01:15）刷新启用源
  - adapter 使用独立 `wrangler.build.jsonc` 输出生成 Worker，生产 `cloudflare/worker.ts` 不再被构建覆盖
  - 线上手动刷新 GitHub Releases JSON 3 条和 Atom 10 条，公开 API与页面展示通过
  - 正式启用 `SvelteKit Releases` Atom 源，首次手动刷新 10 条，供每天北京时间09:15 Cron持续更新
  - 点赞统计与用户点赞交互按产品决策取消，不实现点赞关系表或点赞 API
- 阶段 8 SEO：
  - `/sitemap.xml` 动态输出首页、排行、热榜、可见分类、标签和 `published + public` 内容
  - sitemap按内容类型生成详情路径，输出标准 `lastmod` 并严格转义 XML 实体
  - `/robots.txt` 允许公开页面，禁止后台、API、用户中心、登录、投稿和跳转页，并声明 sitemap 地址
  - 首页、分类、标签、详情、排行榜和热榜均输出唯一 canonical、description 和 Open Graph metadata
  - 线上 sitemap 返回 25 个公开 URL，包含真实分类和内容，排除 admin/login/user 等私有路径
  - 线上六类公开页面 canonical、og:url、og:title、description 均验证为单一标签
- 阶段 8 JSON 备份与恢复：
  - 后台 `/admin/import-export` 提供 JSON 备份下载、文件选择、二次确认和恢复结果
  - 备份格式固定为 `navinest-backup@1`，通过分类/标签/内容自然键迁移引用，不保存数据库自增 ID
  - 导出分类、标签、内容、内容元数据/标签、首页模块、搜索源、热榜源和站点设置
  - 明确排除用户、密码、OAuth、Session、收藏、足迹、私人导航、投稿、消息、统计、文件和 R2 对象
  - 导入限制 2 MiB，完整验证格式、重复自然键、引用关系和热榜公网 URL 后才执行
  - 恢复使用 D1 batch 原子合并；按自然键更新/新增内容并保留原 ID，避免级联删除收藏、足迹和统计
  - 线上真实导出 9.5 KB 备份并原样恢复成功；用户2、足迹3、统计3、内容ID 1–8均保持不变
  - 热榜快照不进备份，恢复后已手动刷新正式源并重建10条快照
- 阶段 8 缓存与状态体验：
  - 首页SSR包含登录身份信息，因此明确使用 `private, no-store`，禁止公共边缘缓存串号
  - 排行榜页面/API使用 `public, max-age=60, s-maxage=300, stale-while-revalidate=600`
  - 热榜页面/API继续 `no-store`，保证手动刷新和 Cron 后立即可见
  - 缓存策略集中于 `cache-policy.ts` 并由单元测试固定身份页、排行榜和实时数据边界
  - 排行榜无数据时解释统计来源并提供首页入口；热榜区分无来源和等待首次刷新
  - 404/错误页增加 `noindex,nofollow`、返回上一页和返回首页，且不输出内部异常细节
  - 线上验证五类路由缓存头、404状态与操作入口均符合预期
- 阶段 8 即时整体回归：
  - 首页、排行榜、热榜、sitemap、robots及公开API均返回200，认证API匿名返回401
  - `/admin/import-export` 与 `/api/admin/backup` 匿名请求均由 Cloudflare Access 302拦截
  - D1核对用户2、分类7、标签7、内容8、搜索源4、首页模块4、启用热榜源1、热榜条目10
  - 首页使用 `private, no-store`，排行使用受限共享缓存，热榜实时接口使用 `no-store`
  - 25个测试文件、84个测试以及 lint/check全部再次通过
  - Cloudflare Cron Events权威记录：`25 1 * * *` 于2026-07-13 01:25:23 UTC执行成功（CPU 4.286 ms），D1于01:25:24写入10条
  - `15 1 * * *` 在01:13:46才部署，Cron Events中没有01:15事件；这是触发器未进入当次调度，而非scheduled handler执行失败
  - 早期`*/15 * * * *`记录显示23:45:08错误、00:00:08成功；23:45失败对应adapter曾覆盖自定义Worker入口的旧版本
  - 已启用Workers Observability（100%采样），scheduled handler输出结构化开始/完成日志，后续可直接核对cron、scheduledTime和各源结果
  - 新增 `0008_cron_health.sql` 和 `cron_runs`，持久化计划/开始/完成时间、状态、源成功/失败计数及错误摘要
  - `scheduled()` 已接入监控服务；部分或整体失败会给所有启用管理员生成未读 `cron_alert` 站内消息
  - 后台 `/admin/cron-runs` 显示北京时间09:15计划、最近运行状态和各源结果，匿名访问继续由Cloudflare Access拦截
  - 监控服务覆盖成功、部分失败告警和致命异常重抛测试；首次正式记录安排于2026-07-14 09:20北京时间自动核验
  - 移动端390×844审计覆盖首页、排行、热榜、登录、搜索、分类、标签、详情和404：无页面级横向溢出、缺失alt或JS错误
  - 后台CSS在≤760px切换单列和横向导航，表格统一在 `admin-table-wrap` 内滚动；真实Access DOM审计无未命名可见控件
  - 新增全局“跳到主要内容”链接；首个Tab可见，Enter后焦点落到 `#main-content`，减少键盘用户重复导航
  - Wrangler上传曾因Node多地址连接临时 `fetch failed`，使用 `NODE_OPTIONS=--dns-result-order=ipv4first` 后部署成功
  - 新增 `scripts/backup-production.mjs` 与灾难恢复手册，自动导出完整D1、R2私有对象、Worker配置、迁移和Secret名称清单
  - 真实备份已保存至 `D:\ProgramData\hermes\navinest-backups\2026-07-13T02-10-20-666Z`：16个校验文件、D1 SQL 28,284字节、SHA-256错误0、Secret值暴露0
  - 当前R2文件索引和对象均为0；脚本支持未来按D1对象键逐个下载并校验
  - 已将完整SQL导入隔离SQLite，核对用户2、内容8、分类7、标签7、热榜源1、Cron记录0，恢复演练通过
- 一为导航对标重构（进行中）：
  - 网页 `https://nav.iowen.cn/` 为最终效果基准，`D:\db\54\onenav` 仅作为模板和功能结构参考
  - 新增 `docs/onenav-benchmark.md`，明确当前粗糙感来源、逐区差距、重构顺序和验收标准
  - 首页第一批完成固定80px顶栏、218px分类侧栏、渐变搜索横幅、热门网址和分类内容模块
  - 内容画布扩展到最大1900px，桌面热门/分类卡片为4列；移动端使用62px顶栏和横向分类导航
  - 卡片增加类型、摘要、标签、详情和经 `/go` 校验的安全直达入口，不恢复点赞写入
  - 线上1920×911验证顶栏80px、侧栏218px、搜索横幅1622×315、热门8卡和分类8卡
  - 线上390×844验证五区域完整、单列卡片、页面宽度390且无横向溢出，控制台无错误
  - 后续继续接入真实图标/封面、父子分类Tab和不同内容类型卡片
  - 首页第二批完成：搜索横幅扩展为604px，核心搜索区800px，底部热门入口条1200×108px
  - 热门网址使用真实 `stats_daily` 浏览/收藏统计排序，桌面6列；生产仅8条公开内容，因此真实展示8卡，不填充假数据
  - 新增310px桌面右侧栏，显示真实站点统计（内容8、分类7、活跃用户2）、今日热榜5条和排行榜
  - 新增 `home-dashboard.ts` 聚合服务，读取启用 `home_modules`、站点统计、真实排行和热榜；服务层SQLite测试通过
  - 生产4个启用首页模块已读取：聚合搜索、常用推荐、开发工具、排行榜
  - 所有首页热榜与网址直达链接继续经过 `/go` 公网URL安全校验
  - 线上1920视口验证搜索横幅1622×604、入口条1200×108、热门6列、右栏310px，无横向溢出
  - 线上390视口验证搜索横幅362×510、入口条342×178、热门单列、右栏隐藏、页面宽度390
  - 当前生产版本 `bc2fbeba-1842-423e-a049-4268a29d6c20`，Cron继续保持北京时间09:15
  - 首页第三批完成五类差异化卡片：网址、文章、软件、书籍和公告拥有独立class、类型色与媒体比例
  - 新增受控公开媒体端点 `/api/content-files/[id]`：仅返回被 `published + public` 内容引用的私有R2文件，未引用ID返回404
  - SVG媒体强制附件，图片响应设置 `nosniff` 与公共缓存；R2保持私有
  - `NavigationItem` 已携带图标/封面文件ID；当前生产R2对象为0，页面使用稳定类型符号且不产生无效媒体请求
  - 分类数据保留 `id/parentId`，父分类模块支持子分类Tab；生产当前无子分类，因此不渲染空Tab
  - 新增移动菜单按钮、遮罩和抽屉分类导航，390视口打开后显示7项，选择分类自动关闭
  - 线上验证五类卡片均存在，桌面保持604px搜索区和310px右栏，移动保持510px搜索区、390px无溢出
  - 当前生产版本 `c85821cc-8218-4e44-bd78-8c94a44a8400`；模块完全按 `home_modules.sort_order` 任意编排仍列入下一批
  - 首页第四批新增 `home-module-plan.ts` 和 `HomeModuleFlow.svelte`，首页主模块真正按 `home_modules.sort_order` 循环渲染
  - `content`模块按 `config.categorySlug`选择分类，同一分类只渲染一次；未配置分类兼容追加在已配置模块后
  - `search`、`ranking`、`hot`、`links`均有安全渲染器；`links`只接受站内路径或HTTP/HTTPS，外链继续经过 `/go`
  - `custom_html`不执行也不进入渲染计划，防止后台配置注入任意脚本
  - 搜索模块在Grid中保持横跨主栏和310px右栏，线上仍为1622×604；移动仍为362×510且无溢出
  - 完成真实可逆排序验收：排行榜临时sort_order=15时DOM为search→ranking→favorites→dev-tools；恢复40后为search→favorites→dev-tools→ranking
  - 验收后D1已确认排行榜模块ID9的sort_order恢复为40，无残留配置变化
  - 当前生产版本 `2dd29727-e5a5-457c-b4df-8b663e7ed07e`；下一批转向分类页、搜索结果页和详情页统一产品化
  - 第五批新增共享 `PublicShell.svelte`：80px顶栏、218px桌面侧栏、面包屑、1620px内容画布、移动抽屉和统一Footer基础区
  - 分类、搜索和标签页全部接入共享壳，保留原canonical/OG，新增渐变listing hero、结果计数和4/3/2/1列响应式差异化卡片
  - 搜索页新增800px站内搜索框和关键词结果状态；生产Cloudflare查询返回1条真实结果
  - `ContentDetail.svelte`一次重构覆盖网址、文章、软件、书籍和公告，保留收藏、浏览、足迹、JSON-LD、分类/标签和 `/go` 安全外链逻辑
  - 五类详情分别使用 `detail-site/post/app/book/bulletin`，拥有独立类型色、图标比例、正文与300px信息侧栏；移动端改为单列
  - 本地与线上分别验证8条代表路由×桌面/移动：全部200、单H1、390/1920无横向溢出、移动抽屉可开关、控制台错误0
  - 部署后首次桌面检查遇到Cloudflare边缘新旧版本短暂混合；等待传播后分类、标签、网址、文章桌面复验均统一命中新壳
  - 当前生产版本 `65e7b0ea-8b51-49ed-8229-c93c7e46b991`；下一批补全Footer/友情链接/移动底部Tabbar和后台媒体关联体验
  - 第六批将共享Footer扩展为三列：品牌说明、真实站内快捷导航和“友情链接”入口区；因无友情链接表，不伪造外部合作站点
  - 新增移动固定底部Tabbar：首页、搜索、排行、热点、我的共5项，并为内容区预留100px避免遮挡Footer
  - 排行榜和热榜页接入 `PublicShell`，保留原缓存策略、canonical/OG和数据服务
  - 排行榜提供日/周/月/总榜，页面只展示综合分、浏览、收藏，不展示已取消功能的点赞文案
  - 热榜按来源卡片化，保留更新时间、热度和描述；所有外链继续经过 `/go`
  - 线上验证日榜7条、周榜7条、热榜10条；Footer三列、移动Tabbar 5项、单H1、1920/390无溢出、控制台错误0
  - 媒体关联审计确认：上传/私有R2/受控公开读取已完成，但 `ItemInput`、AdminItemForm和create/update SQL尚未读写icon_file_id/cover_file_id；下一批必须端到端扩展并测试，不能只加表单下拉框
  - 当前生产版本 `4a0c0fc5-1c7b-4335-8cc8-670de703c55d`；下一批实现后台内容媒体关联并绑定首批真实图标
  - 第七批端到端实现 `iconFileId/coverFileId`：输入验证、图片关系校验、create/update SQL、清空关联、管理员预览和受控公开读取
  - 后台媒体候选改为从受Cloudflare Access保护的 `GET /api/admin/files` 客户端加载，避免媒体列表失败拖垮内容管理SSR；保存时仍由服务端验证文件存在与MIME
  - 修复 `listItems(status:null, visibility:null)` 在空条件时生成裸 `WHERE` 的SQL缺陷，并新增SQLite回归测试
  - 修复后台分类/标签初始化：Svelte select状态为字符串而option值原为数字，严格匹配失败导致编辑内容时分类被提交为空；分类和媒体option现统一显式字符串值
  - 已恢复受影响的4条分类关系，并将VS Code旧地址规范化为 `app_download_url=https://code.visualstudio.com`
  - 上传并绑定4个真实官方图标：Cloudflare #7、Svelte #5、Figma #6、VS Code #8；GitHub源站网络失败时未伪造替代图片
  - 线上1920/390验证4种图标真实加载，尺寸分别64×64、128×128、32×32、256×256，媒体端点均200、PNG、nosniff、公共缓存且无横向溢出
  - 真实删除保护验证：DELETE文件#5返回409，文件索引和Svelte引用均保留
  - 最终D1一致性：8条内容分类完整、files=4、broken_media_refs=0；最终门禁36个测试文件/103个测试全部通过
  - 当前生产版本 `7e01b782-7f9b-42e9-a87f-328383b3a0f7`；下一批继续用户中心、投稿页与后台视觉统一
  - 第八批新增共享 `AccountShell.svelte` 和 `account.css`，复用统一前台顶栏、侧栏、Footer、移动抽屉和底部Tabbar
  - 用户中心重构为资料、账户概览、收藏、最近浏览和自定义导航分区；保留资料PATCH、头像/封面上传替换、旧文件删除和退出登录
  - 我的投稿、站内消息和投稿页统一账户Hero、4项账户子导航、状态卡片和空状态；外部投稿目标继续经过 `/go`
  - 登录页统一为窄账户卡，保留账号密码登录错误反馈、GitHub OAuth和原认证安全逻辑
  - `CustomNavigationManager`保留原分类/链接CRUD和安全跳转，仅统一表单与按钮视觉
  - 线上未登录登录页在1920/390均200、单H1、4项子导航、无溢出和控制台错误；已登录用户中心/投稿/投稿记录/消息在桌面与390移动均通过共享壳验收
  - 最终门禁37个测试文件/106个测试全部通过；当前生产版本 `5dbc21ef-e9be-4f7d-99e2-5f1efd211a17`
  - 第九批通过共享后台layout和 `admin-productization.css` 统一11个管理模块：250px深色侧栏、72px粘性顶栏、1440px内容画布、卡片/表格/表单密度和390px移动抽屉
  - 后台移动菜单具备aria-expanded、遮罩、导航后自动关闭和主内容焦点锚点；真实390px点击验证open=true、backdrop=true
  - `listAdminFiles`新增图标/封面引用聚合，返回内容ID、标题和用途；删除服务端409保护保持不变
  - 文件管理由表格升级为媒体卡：受Access保护的真实预览、MIME/大小/对象键、引用内容链接和用途；被引用文件不渲染删除按钮，未引用文件才可删除
  - 线上概览/内容/文件在1920与390均单H1、11项导航、无溢出和控制台错误；4张R2图片预览自然尺寸正常、4个引用、删除按钮0
  - 最终门禁38个测试文件/109个测试全部通过；当前生产版本 `c09a4f65-a351-4a0d-87af-3b9953fdd76f`
  - 第十批A完成生产关键业务闭环验收：普通用户访问GitHub详情使footprint时间从02:28更新到06:21；收藏PUT后按钮变“取消收藏”、D1统计+1，DELETE后按钮与收藏关系/统计均恢复基线0
  - 真实投稿#8由用户#7创建pending，管理员#1审核后发布临时内容#20并生成未读消息#3；公开详情在390px返回200、单H1、无溢出和控制台错误，消息页可进入已发布内容
  - 临时内容完成媒体上传#9→关联→公开读取200→删除409→解除关联→删除204，D1确认媒体字段NULL且文件索引删除
  - 投稿闭环验收后按依赖顺序清理消息、投稿和内容；生产恢复items=8、submissions=0、messages=0、files=4、favorite(user7,item2)=0，测试slug返回404
  - 清理后正式备份位于 `D:\ProgramData\hermes\navinest-backups\2026-07-13T06-27-53-867Z`，manifest 16项、R2对象4个、SHA错误0；隔离SQLite恢复24张表并确认users=2/items=8/files=4/hot_items=10
  - 备份时真实遇到一次Wrangler R2下载`fetch failed`；新增 `retrySync` 仅重试幂等只读网络操作，瞬时错误最多3次、非瞬时错误不重试
  - 最终门禁39个测试文件/111个测试全部通过；离线脚本修改不影响Worker，生产版本保持 `c09a4f65-a351-4a0d-87af-3b9953fdd76f`
  - 第十批B新增10个真实子分类：开发工具3个、设计资源3个、效率工具4个；公开分类总数由7增至17
  - 新增Docker、MDN、Vite、Dribbble、Coolors、Font Awesome、Notion、Obsidian、Raycast、Todoist、Linear共11条已核验官方内容，公开内容由8增至19，不添加虚假统计或合作关系
  - 修复父分类聚合：分类页与首页父模块同时包含直属和子分类内容；父分类显示“全部+子分类”Tab，子分类页保持直属内容作用域
  - 新增幂等迁移 `0009_content_taxonomy.sql`；首次生产执行因D1 compound SELECT限制回滚，改为VALUES标量子查询后成功执行，broken_new_items=0且4个正式图标引用保持
  - 线上1920/390验收首页、3个父分类、前端开发子分类、Vite搜索及Vite/Notion详情：全部200、单H1、无溢出、控制台错误0，外链继续经过 `/go`
  - 首页真实模块数量：开发5/设计4/效率6，并显示3/3/4个子分类入口；D1权威内容数19
  - 备份审计发现迁移manifest原为0001–0008硬编码；改为动态扫描所有 `migrations/*.sql` 并增加确定性排序测试
  - 最新正式备份 `D:\ProgramData\hermes\navinest-backups\2026-07-13T06-57-29-475Z`：manifest 17项、R2对象4个、SHA错误0、包含0009；隔离恢复items=19/categories=17/childCategories=10/officialItems=11
  - 最终门禁43个测试文件/116个测试全部通过；当前生产版本 `8f96e95b-4fb4-4582-ae8b-59e83b14ec99`
  - 第十批C新增项目内Playwright只读生产冒烟：`npm run smoke:production`，不依赖Hermes外部Playwright安装、不接受Cookie/Access Header且不执行写请求
  - 冒烟清单覆盖首页、Vite搜索、父/子分类、开发标签、五类详情、排行榜、热榜和登录，共13条公开路由×桌面/390移动=26项检查
  - 每项检查HTTP 200、单H1、关键DOM、横向溢出和控制台错误；父分类验证内容/Tab数量，详情外链必须以 `/go?url=` 开头
  - 同时验证首页独立移动抽屉和PublicShell移动抽屉；匿名 `/user` 必须303到登录，匿名 `/admin` 必须由Cloudflare Access或应用拒绝
  - 首次运行纠正了排行榜/热榜selector和两种移动壳菜单selector；最终26项全部通过、错误0、溢出0
  - 冒烟报告写入 `D:\ProgramData\hermes\navinest-production-smoke-latest.json`；Access重定向会剥离query/hash，只保留origin/path，避免持久化短期状态参数
  - 最终门禁44个测试文件/119个测试全部通过；本批仅增加只读测试工具与devDependency，生产版本保持 `8f96e95b-4fb4-4582-ae8b-59e83b14ec99`
  - 第十批D完成Lighthouse生产基线：移动Performance 92/Accessibility 95/Best Practices 100/SEO 100，桌面95/96/100/100；移动LCP 2.3s、桌面0.9s、两端CLS 0/TBT 0ms
  - 对比度审计定位首页侧栏、搜索按钮、卡片摘要/徽章/标签/metrics、子分类Tab和右栏次要文字；新增 `quality-hardening.css` 使用合格深色并保留品牌语义，复验移动/桌面Accessibility均100、color-contrast=1
  - 前台媒体图片增加48×48固有尺寸、lazy loading和async decoding；reduced-motion下全局动画/过渡缩至0.01ms且禁用平滑滚动，浏览器计算样式验证通过
  - 公开内容文件按不可原地替换的文件ID改为一年 `immutable` 缓存；4个实时端点均返回 `max-age=31536000, s-maxage=31536000, immutable`
  - Lighthouse复验Performance移动96、桌面98，LCP分别2.2s/0.8s，CLS 0、TBT 0ms；VS Code源图历史边缘缓存仍可能报告旧13KiB，但实时对象仅709B
  - 生产冒烟扩展为14页面×双视口=28项，并新增robots/sitemap机器路由与404 noindex检查；28页面、2机器、2保护路由全部通过，非预期console错误0、溢出0
  - 404在1920/390真实返回404、单H1、`noindex,nofollow`；robots与sitemap均200且MIME/关键URL正确
  - 最终门禁45个测试文件/123个测试全部通过；当前生产版本 `7b8d3c2e-f8f1-4ab8-8976-48bf8327771a`
  - 最新正式备份 `D:\ProgramData\hermes\navinest-backups\2026-07-13T07-40-26-158Z`：manifest17项、R2对象4个、SHA错误0、含0009，隔离恢复items=19/categories=17
  - 第十批E新增 `.github/workflows/quality.yml`：push/PR/手动触发，Node22+npm缓存，依次执行npm ci、lint、check、test、build，并校验构建前后 `cloudflare/worker.ts` SHA一致；权限仅 `contents: read`，无部署步骤
  - 新增 `.github/workflows/production-smoke.yml`：UTC 02:00（北京时间10:00）每日及手动触发，安装Playwright Chromium，执行匿名只读生产冒烟并保留14天严格JSON Artifact；无Cloudflare/GitHub凭据
  - 工作流结构回归测试验证Node/缓存/命令/最小权限/禁止部署；YAML使用项目依赖解析通过，Artifact本地直接JSON.parse并确认pages=28/machine=2/protected=2
  - 当前目录不是Git仓库且无GitHub remote，因此工作流文件仅已就绪和本地验证，尚未在GitHub Actions在线触发；没有擅自初始化、创建远程或推送
  - 本地首次npm ci遇Windows原生模块锁；将旧依赖树隔离为 `node_modules.locked-20260713-160303` 后，新的空目录npm ci成功。隔离目录仍被运行中进程锁定，暂不能移动/删除，已用 `node_modules*` 从Git/Prettier/ESLint排除
  - 最终按CI同序验证npm ci、lint、check、test、build、Worker哈希和只读生产冒烟全部通过；46个测试文件/125个测试，生产版本不变
  - 第十批F新增集中浏览器安全策略：CSP（self源、禁止object/frame、限制base/form/connect）、HSTS一年、Referrer-Policy、Permissions-Policy、nosniff、DENY和COOP；动态HTML、登录、用户重定向、媒体及robots实时响应均验证生效
  - 身份相关 `/login`、`/contribute`、`/user*`、`/admin*`、`/api/auth*`、`/api/user*`、`/api/admin*` 统一覆盖 `Cache-Control: private, no-store`，公开媒体和排行等保留原有差异策略
  - CSP暂保留Svelte hydration所需的inline script/style，生产28页面冒烟与两种移动抽屉均正常、console错误0；未伪称为nonce级严格CSP
  - 安全跳转真实验证javascript、loopback、metadata IP和带凭据URL均拒绝且无继续链接，合法HTTPS才显示 `noopener noreferrer` 访问入口；5项已纳入生产冒烟
  - npm官方Registry审计critical/high/moderate均0、low=4，均来自SvelteKit携带的cookie<0.7字符边界告警；项目Cookie名称/path/domain为代码常量且npm建议异常降级到0.0.x，因此未执行force修复
  - 安全冒烟扩展检查CSP/HSTS/nosniff/frame/referrer/permissions头；sitemap加唯一query绕过历史边缘缓存，最终pages=28/machine=2/protected=2、错误0
  - 最终门禁47个测试文件/128个测试全部通过；当前生产版本 `75be0587-25f1-49f2-9c08-aacbaa27b70e`
  - 最新正式备份 `D:\ProgramData\hermes\navinest-backups\2026-07-13T08-38-12-459Z`：manifest17项、R2对象4个、SHA错误0，隔离恢复items=19/categories=17

## 重要技术决策

- 前端和 API 使用 SvelteKit。
- 正式构建使用 `@sveltejs/adapter-cloudflare`。
- 本地 `npm run dev` 使用 `@sveltejs/adapter-auto`。
- 原因：当前 Windows 环境下 Cloudflare adapter 的 dev platform proxy 会启动 `workerd`，本机 `workerd` 出现 access violation 崩溃。正式 `npm run build` 不受影响。
- Wrangler 类型生成使用 `--include-runtime false`。
- 原因：完整 runtime types 在当前环境下也会触发 `workerd` 崩溃；当前阶段只需要 Cloudflare Env 绑定类型。
- `worker-configuration.d.ts` 由 Wrangler 生成，不交给 Prettier 格式化。
- 业务 Env 类型另放在 `src/cloudflare-env.d.ts`，避免 `svelte-check` 扫描 `.svelte-kit` 构建产物。
- Cloudflare Access 作为后台边界认证层，应用内仍使用 D1 管理员角色二次授权。
- 后台部署环境缺少 D1 或授权查询失败时拒绝访问，不使用本地 fallback 掩盖错误。
- 内容关系更新通过 D1 `batch` 原子同步主记录、标签和扩展字段。
- 本地 fallback 后台只用于浏览预览；所有修改入口必须存在真实 D1 binding。
- 后台页面 actions 和 `/api/admin/*` 共用校验与写入服务，避免两套业务规则漂移。

## 当前可用命令

```sh
npm run dev
npm run lint
npm run check
npm run test
npm run build
```

本地开发地址：

```text
http://127.0.0.1:5173
```

## 验证记录

最近一次验证全部通过：

- `npm run lint`
- `npm run check`
- `npm run test`
- `npm run build`

当前共 47 个测试文件、128 个测试用例，全部通过。

后台写入验证覆盖：

- 分类、标签和内容输入的正常化与字段级错误
- 私网、保留地址和类型不支持的内容扩展字段被拒绝
- 使用 Node 内存 SQLite 执行真实创建、更新、删除 SQL
- 内容标签和扩展字段替换保持一致
- 跨类型分类/标签关系被拒绝
- 分类父子环路被拒绝
- 已被引用的分类和标签不能改变内容类型
- 表单控件到校验输入的转换
- JSON API 正文格式与正整数路由 ID
- 管理 API 的 `400`、`404`、`409` 和 `503` 错误映射

浏览器验证覆盖：

- 1280 × 900 桌面视口：首页 5 个分类分区、6 个卡片正常渲染，无横向溢出
- 390 × 844 移动视口：单列卡片、顶部粘性分类导航正常，无页面级横向溢出
- `/search?q=prototype` 返回 Figma
- `/categories/dev-tools` 返回 GitHub 和 Svelte
- `/tags/design` 返回 Figma 和 The Design of Everyday Things
- 未知分类返回 404
- `/sites/github` 正确显示详情、分类和安全跳转入口
- 合法外链显示目标域名和继续访问按钮
- `javascript:` 等危险目标被拦截，且不渲染外链按钮
- 首页卡片详情链接与标签链接指向不同的正确路由
- 文章详情输出正确的绝对 canonical、`og:type=article` 和 `Article` JSON-LD
- 未知路由展示统一 404 页面和首页恢复入口
- 使用 Node 内存 SQLite 成功执行完整 schema 与 seed，外键和 SQL 语法通过

本地 D1 schema/seed 实跑仍会触发当前 Windows 环境的 `workerd` access violation。该问题与阶段 1 记录一致；服务层 SQL 参数、映射和边界行为已由单元测试验证，真实 D1 联调需在 Cloudflare 资源创建后完成。

## 当前文件重点

- 开发大纲：`docs/development-outline.md`
- 开发进度：`docs/development-progress.md`
- Cloudflare 配置：`wrangler.jsonc`
- 初始 schema：`migrations/0001_initial.sql`
- seed 数据：`migrations/seed.sql`
- 首页：`src/routes/+page.svelte`
- 全局样式：`src/routes/layout.css`
- 首页 mock 数据：`src/lib/data/navigation.ts`
- 项目配置：`src/lib/config.ts`
- 核心类型：`src/lib/types/content.ts`
- D1 访问入口：`src/lib/server/db.ts`
- 查询服务：`src/lib/server/services/`
- 可复用前台组件：`src/lib/components/`
- 首页服务端加载：`src/routes/+page.server.ts`
- 基础 API：`src/routes/api/`
- 搜索页：`src/routes/search/`
- 分类页：`src/routes/categories/[slug]/`
- 标签页：`src/routes/tags/[slug]/`
- 详情视图服务：`src/lib/server/services/content-detail.ts`
- 详情页面加载：`src/lib/server/load-detail.ts`
- 外链安全校验：`src/lib/server/safe-target.ts`
- 主题开关：`src/lib/components/ThemeToggle.svelte`
- 全局错误页：`src/routes/+error.svelte`
- 导航加载状态：`src/routes/+layout.svelte`
- Cloudflare Access 配置：`docs/cloudflare-access.md`
- 后台守卫：`src/hooks.server.ts`
- 管理员授权：`src/lib/server/admin-auth.ts`
- 后台只读数据：`src/lib/server/services/admin-data.ts`
- 后台输入校验：`src/lib/server/admin-validation.ts`
- 后台写入服务：`src/lib/server/services/admin-write.ts`
- 后台请求适配：`src/lib/server/admin-mutations.ts`
- 后台内容表单：`src/lib/components/admin/AdminItemForm.svelte`
- 后台页面：`src/routes/admin/`
- 后台管理 API：`src/routes/api/admin/`

## 下一步任务

阶段 8：SEO、导入导出与优化。

建议按以下顺序推进：

1. 阶段8整体回归与Cron真实触发验收已完成。
2. 持续观察长期运行数据与外部热榜源稳定性。
3. 根据实际使用反馈迭代功能。

## 长期维护

- 每日核对Cron运行记录和外部热榜源稳定性。
- 定期执行完整灾难恢复备份并在隔离SQLite中校验导入。
- 根据实际使用反馈迭代功能与可访问性。

## 注意事项

- 不要修改 OneNav 源码目录；它只作为功能参考。
- 不要引入 OneNav 授权、混淆或商业主题代码。
- 优先保证每个阶段都能通过 `lint/check/test/build`。
- 每完成一个阶段或关键功能，都更新本文件。
