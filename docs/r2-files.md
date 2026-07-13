# R2 文件上传与索引流程

NaviNest 使用私有 R2 bucket `FILES` 保存文件，并使用 D1 `files` 表保存索引。当前不生成公开 URL，也不提供匿名读取接口。

## 后台入口

- 页面：`/admin/files`
- 上传 API：`POST /api/admin/files`，请求格式为 `multipart/form-data`，字段名 `file`
- 删除 API：`DELETE /api/admin/files/:id`

以上入口都位于 `/admin*` 或 `/api/admin*`，必须由 Cloudflare Access 和应用内管理员守卫共同保护。

## 上传规则

当前允许：

- JPEG
- PNG
- WebP
- GIF
- SVG

单文件最大 5 MiB，不接受空文件。扩展名根据 MIME 类型生成，不信任客户端文件名。

对象键格式：

```text
uploads/{yyyy}/{mm}/{uuid}.{ext}
```

上传顺序：

1. 校验 MIME 类型和大小。
2. 生成不透明对象键。
3. 写入 R2，并设置 Content-Type metadata。
4. 写入 D1 `files` 索引。
5. 如果 D1 写入失败，删除刚写入的 R2 对象作为补偿。

## 删除规则

删除前检查 `items.cover_file_id` 和 `items.icon_file_id`。文件仍被内容引用时返回 `409`，不删除对象或索引。

未被引用时删除 R2 对象，再删除 D1 索引。不存在的文件返回 `404`。

## 当前边界

- Bucket 保持私有，`public_url` 写入 `NULL`。
- 暂未提供文件预览或下载代理。
- 暂未提取图片宽高，`width` 和 `height` 保持 `NULL`。
- SVG 只作为私有对象存储；未来提供浏览器读取时必须使用安全响应头或进行内容净化，不能直接以内联 HTML 方式渲染。
- 真实 R2 与 D1 的端到端联调需在 Cloudflare 资源创建后执行。
