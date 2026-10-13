# NaviNest

NaviNest 是一个部署在 Cloudflare 上的个人导航、收藏与内容管理系统。

## 技术栈

- Svelte 5 / SvelteKit 2
- TypeScript
- Cloudflare Workers、D1、R2、KV 与 Access
- Vitest 与 Playwright

公共界面的设计与交互约定见 [`docs/ui-guidelines.md`](docs/ui-guidelines.md)。

## 本地开发

```bash
npm ci
npm run dev
```

## 质量门禁

```bash
npm run lint
npm run check
npm run test
npx playwright install chromium
npm run test:home-layout
npm run build
```

只读生产冒烟：

```bash
npm run smoke:production
```

冒烟覆盖公开核心路由的桌面与移动视口、404、robots、sitemap、安全响应头、受保护路由和安全外链。

## 部署

生产部署使用 Wrangler，Worker 入口为：

```text
cloudflare/worker.ts
```

构建前后必须确认该入口文件哈希不变，以保留自定义 `scheduled()` 处理器。

## 定时任务

`wrangler.jsonc` 只配置一条 `*/15 * * * *`，每天唤醒 96 次。调度器按事件的 `scheduledTime`（UTC）选择任务，其余时段直接返回，不访问 D1 / R2。

| 任务     | UTC   | 北京时间   |
| -------- | ----- | ---------- |
| 数据备份 | 19:00 | 次日 03:00 |
| 热榜刷新 | 01:15 | 09:15      |
| 系统清理 | 03:00 | 11:00      |

延迟送达的事件仍按原计划时间分派；热榜日志保留逻辑任务表达式 `15 1 * * *`。旧的三个独立表达式在代码中兼容，方便部署过渡；正式配置只保留统一触发器。调度器不补跑缺失事件，也不新增自动重试或去重保证。

触发器名额按 Cloudflare 账号统计，本项目从 3 条减少为 1 条；这不改变 Worker 计划的 CPU 限制。部署成功不等于下一次任务已执行，应分别核对 Cloudflare Cron Events、热榜运行记录和 R2 备份文件。

详细实施进度与验收证据见 [`docs/development-progress.md`](docs/development-progress.md)。
