# NaviNest 导航巢开发大纲

## 1. 项目定位

NaviNest 是一个部署在 Cloudflare 上的个人云端导航与收藏空间，访问域名为 `nss.whks.de`。

目标是参考 OneNav 的产品能力，重新实现一套 Cloudflare 原生导航系统。项目不迁移 WordPress，不使用 OneNav 授权或混淆代码，不做商业授权系统。

核心定位：

- 个人导航首页
- 分类收藏管理
- 聚合搜索入口
- 用户收藏与足迹
- 用户自定义导航
- 投稿审核
- 排行榜
- 外部热榜抓取
- Cloudflare 原生部署

## 2. 不做范围

第一阶段明确不做以下功能：

- WordPress 兼容
- OneNav 源码迁移
- 主题授权系统
- 支付下载
- 付费投稿
- 广告位购买支付
- QQ、微信、微博、Gitee 登录
- 短信验证
- 邮件验证
- Turnstile 验证码
- 多租户 SaaS

## 3. 推荐技术架构

前端与服务端：

- SvelteKit
- `@sveltejs/adapter-cloudflare`
- TypeScript
- Tailwind CSS

Cloudflare 服务：

- Cloudflare Pages 或 Workers：部署前端与 API
- Cloudflare D1：主数据库
- Cloudflare R2：图片、图标、头像、封面、附件
- Cloudflare KV：缓存配置、热榜结果、轻量运行时状态
- Cloudflare Cron Triggers：定时抓取热榜、刷新统计缓存
- Cloudflare Access：保护后台 `/admin`

登录方案：

- 普通用户：账号密码登录
- 第三方登录：GitHub OAuth
- 管理后台：Cloudflare Access + 应用内管理员权限

## 4. 功能总览

### 4.1 导航核心

- 导航首页
- 分类侧栏
- 多级分类
- 标签
- 网址卡片
- 卡片排序
- 热门网址
- 网址详情页
- 外链安全跳转页 `/go?url=`
- 暗色模式
- 响应式布局
- 空状态、错误页、加载状态

### 4.2 内容类型

统一内容模型支持以下类型：

- `site`：网址
- `post`：文章
- `app`：APP/资源
- `book`：书籍/影视
- `bulletin`：公告

不同内容类型通过 `items.type` 区分，扩展字段放入 `item_meta`。

### 4.3 搜索

- 站内搜索
- 搜索源分组
- 自定义外部搜索引擎
- 搜索关键词快捷入口
- 搜索结果页

示例搜索源：

- 百度
- Google
- Bing
- GitHub
- 知乎
- 微博
- 豆瓣
- 淘宝
- 京东
- 站内网址
- 站内文章

### 4.4 用户系统

- 用户注册开关
- 账号密码登录
- GitHub OAuth 登录
- 退出登录
- 用户资料
- 头像上传
- 封面上传
- 用户中心
- 登录失败次数限制

个人使用建议：

- 默认关闭公开注册
- 管理员可手动创建用户
- 需要时再开启注册

### 4.5 用户中心

- 我的收藏
- 我的足迹
- 我的自定义导航
- 我的投稿
- 我的消息
- 账号资料
- 安全设置

### 4.6 用户自定义导航

- 用户自定义分类
- 用户自定义链接
- 拖拽排序
- 导入浏览器书签
- 搜索自定义链接
- 可选公开分享页

### 4.7 投稿审核

投稿类型：

- 网址
- 文章
- APP/资源
- 书籍/影视

投稿流程：

1. 用户提交内容
2. 进入待审核状态
3. 管理员审核
4. 审核通过后发布到正式内容
5. 审核结果写入站内消息

支持状态：

- `draft`
- `pending`
- `approved`
- `rejected`
- `published`

### 4.8 排行榜

榜单类型：

- 日榜
- 周榜
- 月榜
- 总榜

统计维度：

- 浏览
- 点赞
- 收藏
- 评论，预留
- 下载，预留

### 4.9 热榜抓取

支持热榜源类型：

- JSON API
- RSS
- HTML 抓取，后续可选

热榜流程：

1. 管理员配置热榜源
2. Cron 定时请求外部数据
3. Worker 解析数据
4. 写入 D1 或 KV 缓存
5. 前台展示热榜列表

第一版建议支持：

- JSON API
- RSS
- 手动刷新
- 定时刷新
- 缓存过期时间

### 4.10 SEO

- 页面 title
- meta description
- Open Graph
- canonical
- robots.txt
- sitemap.xml
- 分类页 SEO
- 标签页 SEO
- 详情页 SEO

## 5. 前台页面规划

- `/`：导航首页
- `/search`：站内搜索结果
- `/go`：外链跳转页
- `/sites/:slug`：网址详情
- `/apps/:slug`：APP/资源详情
- `/books/:slug`：书籍/影视详情
- `/posts/:slug`：文章详情
- `/bulletins/:slug`：公告详情
- `/categories/:slug`：分类页
- `/tags/:slug`：标签页
- `/rankings`：排行榜
- `/hotnews`：今日热榜
- `/login`：登录
- `/register`：注册，默认可关闭
- `/contribute`：投稿页
- `/user`：用户中心首页
- `/user/favorites`：我的收藏
- `/user/footprints`：我的足迹
- `/user/custom`：我的自定义导航
- `/user/submissions`：我的投稿
- `/user/messages`：站内消息
- `/user/settings`：账号设置

## 6. 后台页面规划

后台入口：`/admin`

访问策略：

- `/admin` 由 Cloudflare Access 保护
- 应用内部仍检查当前用户是否为管理员

页面：

- `/admin`：后台概览
- `/admin/items`：全部内容
- `/admin/sites`：网址管理
- `/admin/apps`：APP/资源管理
- `/admin/books`：书籍/影视管理
- `/admin/posts`：文章管理
- `/admin/bulletins`：公告管理
- `/admin/categories`：分类管理
- `/admin/tags`：标签管理
- `/admin/submissions`：投稿审核
- `/admin/users`：用户管理
- `/admin/messages`：站内消息
- `/admin/home-modules`：首页模块配置
- `/admin/search-engines`：搜索源配置
- `/admin/hot-sources`：热榜源配置
- `/admin/files`：文件管理
- `/admin/settings`：站点设置
- `/admin/import-export`：导入导出

## 7. 数据库设计

数据库：Cloudflare D1

### 7.1 users

用户表。

字段：

- `id`
- `email`
- `username`
- `display_name`
- `password_hash`
- `avatar_file_id`
- `cover_file_id`
- `role`
- `status`
- `created_at`
- `updated_at`
- `last_login_at`

### 7.2 oauth_accounts

第三方登录绑定。

字段：

- `id`
- `user_id`
- `provider`
- `provider_user_id`
- `provider_username`
- `access_token_encrypted`
- `created_at`
- `updated_at`

第一版只实现 `provider = github`。

### 7.3 categories

分类表。

字段：

- `id`
- `type`
- `parent_id`
- `name`
- `slug`
- `icon`
- `description`
- `sort_order`
- `is_visible`
- `created_at`
- `updated_at`

### 7.4 tags

标签表。

字段：

- `id`
- `type`
- `name`
- `slug`
- `description`
- `created_at`
- `updated_at`

### 7.5 items

统一内容表。

字段：

- `id`
- `type`
- `category_id`
- `author_id`
- `title`
- `slug`
- `summary`
- `content`
- `cover_file_id`
- `icon_file_id`
- `status`
- `visibility`
- `sort_order`
- `is_featured`
- `published_at`
- `created_at`
- `updated_at`

### 7.6 item_meta

内容扩展字段。

字段：

- `id`
- `item_id`
- `meta_key`
- `meta_value`

示例：

- `site_url`
- `site_type`
- `app_platform`
- `app_download_url`
- `book_score`
- `book_author`
- `book_download_url`

### 7.7 item_tags

内容标签关联。

字段：

- `item_id`
- `tag_id`

### 7.8 favorites

用户收藏。

字段：

- `id`
- `user_id`
- `item_id`
- `created_at`

### 7.9 footprints

用户足迹。

字段：

- `id`
- `user_id`
- `item_id`
- `visited_at`

### 7.10 custom_categories

用户自定义导航分类。

字段：

- `id`
- `user_id`
- `parent_id`
- `name`
- `icon`
- `sort_order`
- `created_at`
- `updated_at`

### 7.11 custom_links

用户自定义导航链接。

字段：

- `id`
- `user_id`
- `category_id`
- `title`
- `url`
- `icon_url`
- `summary`
- `sort_order`
- `status`
- `created_at`
- `updated_at`

### 7.12 submissions

投稿记录。

字段：

- `id`
- `user_id`
- `target_item_id`
- `type`
- `title`
- `payload_json`
- `status`
- `reviewer_id`
- `review_message`
- `reviewed_at`
- `created_at`
- `updated_at`

### 7.13 messages

站内消息。

字段：

- `id`
- `user_id`
- `sender_id`
- `type`
- `title`
- `content`
- `data_json`
- `is_read`
- `created_at`

### 7.14 stats_daily

每日统计。

字段：

- `id`
- `item_id`
- `date`
- `views`
- `likes`
- `favorites`
- `comments`
- `downloads`

### 7.15 home_modules

首页模块配置。

字段：

- `id`
- `type`
- `title`
- `config_json`
- `sort_order`
- `is_enabled`
- `created_at`
- `updated_at`

模块类型：

- `search`
- `content`
- `hot`
- `ranking`
- `custom_html`
- `links`

### 7.16 search_engines

搜索源配置。

字段：

- `id`
- `group_key`
- `name`
- `key`
- `url_template`
- `placeholder`
- `sort_order`
- `is_enabled`

### 7.17 hot_sources

热榜源配置。

字段：

- `id`
- `name`
- `type`
- `url`
- `headers_json`
- `parser_json`
- `cache_ttl`
- `is_enabled`
- `last_fetch_at`
- `created_at`
- `updated_at`

### 7.18 hot_items

热榜结果。

字段：

- `id`
- `source_id`
- `rank`
- `title`
- `url`
- `hot_value`
- `extra_json`
- `fetched_at`

### 7.19 files

R2 文件索引。

字段：

- `id`
- `user_id`
- `bucket`
- `object_key`
- `public_url`
- `mime_type`
- `size`
- `width`
- `height`
- `created_at`

### 7.20 settings

站点配置。

字段：

- `key`
- `value_json`
- `updated_at`

## 8. R2 使用方案

R2 存储：

- 网址图标
- 网址截图
- APP 图标
- APP 截图
- 书籍封面
- 用户头像
- 用户封面
- 投稿附件

对象路径建议：

- `icons/{yyyy}/{mm}/{id}.{ext}`
- `covers/{yyyy}/{mm}/{id}.{ext}`
- `avatars/{user_id}/{id}.{ext}`
- `uploads/{user_id}/{yyyy}/{mm}/{id}.{ext}`

## 9. KV 使用方案

KV 适合存：

- 首页缓存
- 热榜缓存
- 站点配置缓存
- 搜索源缓存
- 排行榜缓存
- GitHub OAuth state 临时值

不适合存强一致数据，核心业务数据仍放 D1。

## 10. Cron 使用方案

定时任务：

- 每 15 分钟抓取热榜源
- 每小时刷新排行榜缓存
- 每天生成 sitemap 缓存
- 每天清理过期 OAuth state
- 每天归档或清理过旧足迹，后续可选

## 11. API 规划

认证：

- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/auth/me`
- `GET /api/auth/github`
- `GET /api/auth/github/callback`

内容：

- `GET /api/items`
- `GET /api/items/:id`
- `POST /api/items`
- `PATCH /api/items/:id`
- `DELETE /api/items/:id`

分类与标签：

- `GET /api/categories`
- `POST /api/categories`
- `PATCH /api/categories/:id`
- `DELETE /api/categories/:id`
- `GET /api/tags`
- `POST /api/tags`

用户：

- `GET /api/user/profile`
- `PATCH /api/user/profile`
- `GET /api/user/favorites`
- `POST /api/user/favorites`
- `DELETE /api/user/favorites/:id`
- `GET /api/user/footprints`
- `POST /api/user/footprints`

自定义导航：

- `GET /api/user/custom-categories`
- `POST /api/user/custom-categories`
- `PATCH /api/user/custom-categories/:id`
- `DELETE /api/user/custom-categories/:id`
- `GET /api/user/custom-links`
- `POST /api/user/custom-links`
- `PATCH /api/user/custom-links/:id`
- `DELETE /api/user/custom-links/:id`

投稿：

- `GET /api/submissions`
- `POST /api/submissions`
- `PATCH /api/submissions/:id`
- `PATCH /api/admin/submissions/:id/review`

文件：

- `POST /api/files/upload`
- `GET /api/files`
- `DELETE /api/files/:id`

搜索与统计：

- `GET /api/search`
- `POST /api/stats/view`
- `POST /api/stats/like`
- `GET /api/rankings`

热榜：

- `GET /api/hotnews`
- `POST /api/admin/hot-sources/:id/refresh`

系统：

- `GET /sitemap.xml`
- `GET /robots.txt`

## 12. 开发阶段

### 阶段 1：项目骨架

- 初始化 SvelteKit 项目
- 配置 Cloudflare adapter
- 配置 TypeScript
- 配置 Tailwind CSS
- 配置 D1、R2、KV bindings
- 建立基础目录结构
- 添加 README
- 添加环境变量示例

验收标准：

- 本地可启动
- 可部署到 Cloudflare
- 首页能正常访问

### 阶段 2：数据库与基础模型

- 编写 D1 migration
- 实现数据库访问层
- 实现内容、分类、标签基础模型
- 写入 seed 数据

验收标准：

- 能通过 API 获取分类和网址
- 首页能渲染 seed 导航数据

### 阶段 3：导航前台

- 首页布局
- 分类侧栏
- 搜索框
- 网址卡片
- 分类页
- 标签页
- 详情页
- 外链跳转页
- 暗色模式
- 响应式适配

验收标准：

- 个人导航核心体验可用
- 移动端和桌面端都能正常浏览

### 阶段 4：后台管理

- Cloudflare Access 保护说明
- 应用内管理员检查
- 内容 CRUD
- 分类 CRUD
- 标签 CRUD
- 首页模块配置
- 搜索源配置
- R2 文件上传

验收标准：

- 管理员能在后台添加分类和网址
- 前台能实时展示新增内容

### 阶段 5：认证与用户中心

- 账号密码登录
- GitHub OAuth 登录
- Session 管理
- 用户资料
- 收藏
- 足迹
- 用户自定义导航
- 头像/封面上传

验收标准：

- 用户可登录
- 用户可收藏网址
- 用户可管理自己的自定义导航

### 阶段 6：投稿审核与消息

- 投稿页面
- 投稿 API
- 投稿列表
- 审核后台
- 审核通过发布内容
- 审核消息通知
- 站内消息中心

验收标准：

- 用户可投稿
- 管理员可审核
- 用户能收到审核结果

### 阶段 7：排行榜与热榜

- 浏览统计
- 点赞统计
- 收藏统计
- 日榜、周榜、月榜
- 热榜源配置
- JSON/RSS 抓取
- Cron 定时刷新
- 手动刷新

验收标准：

- `/rankings` 可展示榜单
- `/hotnews` 可展示外部热榜

### 阶段 8：SEO、导入导出与优化

- sitemap
- robots
- OG meta
- JSON 导入导出
- 配置备份
- 首页缓存
- 排行榜缓存
- 错误页与空状态完善

验收标准：

- 可作为正式个人导航站长期使用
- 可备份和迁移数据

## 13. MVP 验收清单

第一版完成时至少满足：

- 能部署到 `nss.whks.de`
- 首页导航可用
- 分类和标签可用
- 站内搜索可用
- 外部搜索源可用
- 网址详情可用
- 外链跳转可用
- 后台可管理网址、分类、标签
- R2 图片上传可用
- 账号密码登录可用
- GitHub 登录可用
- 收藏可用
- 足迹可用
- 用户自定义导航可用
- 投稿审核可用
- 站内消息可用
- 排行榜可用
- 热榜抓取可用
- sitemap 可用
- 暗色模式可用
- 移动端可用

## 14. 官方文档参考

- Cloudflare Workers: https://developers.cloudflare.com/workers/
- Cloudflare D1: https://developers.cloudflare.com/d1/
- Cloudflare R2: https://developers.cloudflare.com/r2/
- Cloudflare KV: https://developers.cloudflare.com/kv/
- Cloudflare Cron Triggers: https://developers.cloudflare.com/workers/configuration/cron-triggers/
- Cloudflare Access: https://developers.cloudflare.com/cloudflare-one/applications/
- SvelteKit Cloudflare adapter: https://svelte.dev/docs/kit/adapter-cloudflare
