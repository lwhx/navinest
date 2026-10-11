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

详细实施进度与验收证据见 [`docs/development-progress.md`](docs/development-progress.md)。
