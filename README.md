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

延迟送达的事件仍按原计划时间分派；热榜日志保留逻辑任务表达式 `15 1 * * *`。旧的三个独立表达式在代码中兼容，方便部署过渡；正式配置只保留统一触发器。调度器不自动补跑缺失事件。三项任务共用原子运行保护，运行记录保留期间，同一计划事件或同一补跑请求不会重复执行。

触发器名额按 Cloudflare 账号统计，本项目从 3 条减少为 1 条；这不改变 Worker 计划的 CPU 限制。部署成功不等于下一次任务已执行，应分别核对 Cloudflare Cron Events、热榜运行记录和 R2 备份文件。

管理员可在「定时任务」查看三项任务的下次计划、最近执行、最近成功、总耗时和错误，按任务筛选最近 50 条历史。立即补跑沿用管理员会话与同源表单保护，记录操作者，并同步等待执行结果；失败后也刷新记录。空闲 Cron 不创建记录。耗时包含网络等待，不是 CPU 使用量。

手动备份独立写入 `manual-backups/`，与每日 `backups/` 各保留最近 14 份，可在「导入导出」下载。成功/失败记录通常保留 30 天；运行中记录不会被清理或自动解除保护。超过 30 分钟无完成记录时，管理员须先核对服务日志、确认原任务已停止，再显式解除运行标记；这不会终止原 Worker。任务因断连、平台限额或运行时终止而未完成时，需要按此流程核对，不能把超时当作已取消。

详细实施进度与验收证据见 [`docs/development-progress.md`](docs/development-progress.md)。
