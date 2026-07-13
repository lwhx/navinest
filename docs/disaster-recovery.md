# NaviNest 灾难恢复

## 备份内容

- `database.sql`：完整远端D1结构与数据，包括用户、会话、私人数据、统计和Cron记录。
- 可选的 `site-backup.json`：从后台“导入导出”下载的业务级可迁移备份；完整恢复不依赖它。
- `r2-manifest.json` 与 `r2/`：D1文件索引对应的私有R2对象及元数据。
- `wrangler.jsonc`、`wrangler.build.jsonc`、`cloudflare-worker.ts`、`migrations/`：Worker与数据库配置。
- `secrets.json`：仅包含需要重新配置的Secret名称，不包含值。
- `manifest.json`：文件大小与SHA-256校验和。

## 恢复顺序

1. 创建或选择Cloudflare Worker、D1、R2、KV资源，更新`wrangler.jsonc`中的资源ID。
2. 用D1 SQL恢复完整数据库：`npx wrangler d1 execute <db> --remote --file database.sql`。对已有数据库恢复前应先建立快照并在隔离环境演练。
3. 按`r2-manifest.json`将`r2/`中的对象逐个上传到私有R2 Bucket，保持对象键不变。
4. 逐个重新设置`secrets.json`列出的Secret：`npx wrangler secret put <NAME>`。不要把Secret值写入备份目录。
5. 安装依赖，运行`npm run lint && npm run check && npm run test && npm run build`。
6. 部署Worker：`npx wrangler deploy`。
7. 验证首页、认证、后台Access、私有文件、热榜、Cron和备份导入导出。
8. 用`manifest.json`重新计算SHA-256，确保备份未损坏。

## 执行生产备份

在项目根目录运行：

```bash
node scripts/backup-production.mjs
```

脚本默认写入 `D:\ProgramData\hermes\navinest-backups\<UTC时间>`，不会把Secret值写入备份。若Wrangler出现多地址连接错误，脚本已固定Node优先IPv4。

## 安全要求

备份包含账号、Session和私人数据，应存放在加密磁盘或加密归档中，限制访问并设置保留期限。不得公开上传、提交Git或发送到无访问控制的云盘。
