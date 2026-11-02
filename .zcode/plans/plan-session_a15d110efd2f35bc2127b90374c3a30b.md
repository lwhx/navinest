# 后台内容管理重构（对标一为导航）

## Context

用户反馈后台内容管理（`/admin/items`、`/admin/categories`）体验差：排序要先进专门的「排序模式」、分类只能手填数字排序值且每次改要整页刷新、把内容移到别的分类必须打开编辑弹窗重新选三级级联分类、操作后没有任何成功提示。要求改成一为导航那样：**选个分类直接看到内容、直接拖拽排序、分类也能拖、操作简单直接**。

勘察结论：主干上已有全部基础设施——行组件自带原生 HTML5 拖拽把手和 ↑/↓ 按钮（`AdminContentRow.svelte`）、原子化全量排序 API（`content-order.ts` 的 `reorderItems`，json_each 单语句）、纯排序函数（`content-ordering.ts` 的 `moveOrderedItem`）、按分类完整加载的逻辑（`admin-content.ts:78-91`）。**不需要新增依赖**（仓库惯例：不新增依赖/迁移/绑定）。要做的是拆掉门槛、补齐缺口：

1. 排序模式（`?mode=sort`）废除——浏览单个分类 = 就是可拖拽视图
2. 分类管理加拖拽 + ↑/↓ 排序（新增分类排序 API，模式照抄 content-order.ts）
3. 批量「移动到分类」（扩展现有 bulk 端点）
4. 操作成功反馈（激活 `?created=1` 等死参数）

## 改动内容

### A. 服务端（4 个文件）

**`src/lib/server/services/admin-content.ts`**
- `loadAdminContent`：`orderComplete` 不再要求 `mode==='sort'`，改为 `category !== 'all' && !q && status==='all' && visibility==='all' && total <= ADMIN_SORT_LIMIT` 时加载完整分类并置 true；`adminContentFilters` 删除 `mode` 字段。
- 同一查询批次加每分类计数：`SELECT category_id, COUNT(*) FROM items WHERE type=? GROUP BY category_id`（供侧栏角标），放进返回 data。
- `bulkUpdateAdminContent`（:151）新增 `move` 动作：参数 `categoryId`，校验分类存在且 `type` 与所选内容一致（混类型报错），复用 admin-write 的分类校验；单语句 `json_each` 批量 `UPDATE items SET category_id=?`，sort_order 追加到目标分类末尾（先 `SELECT MAX(sort_order)` 再写入 `(max+i+1)*10`，避免与现有排序值纠缠）。上限维持 50。

**`src/lib/server/services/category-order.ts`（新建，照抄 content-order.ts 模式）**
- `reorderCategories(db, {type, parentId, categoryIds})`：scope 为 `WHERE type=? AND parent_id IS ?`（parentId 可 null = 顶层），原子化全量兄弟排序，`(i+1)*10`，范围不完整抛 `AdminWriteError`。

**`src/routes/api/admin/categories/order/+server.ts`（新建）**
- PUT `{type, parentId, categoryIds}` → `reorderCategories`，错误经 `mutationApiError` 映射；admin 路由已由 hooks 统一鉴权。

### B. 内容管理页 `src/routes/admin/items/+page.svelte`

- **加分类侧栏**（一为导航式）：左侧列出当前类型的分类（带内容数角标）+ 全部/未分类，点击即按分类浏览（URL 用现有 `category` 参数，`data-sveltekit-noscroll`）；移动端折叠成横向滚动条。样式进 `admin-content-workbench.css`。
- **拖拽常驻**：删除 `sortingMode`/进入排序按钮/`mode=sort` 相关分支（约 :43-44, :125-145, :302-308, :362-421 的 mode 条件），只要 `data.orderComplete` 就渲染 `AdminContentRow` 的 `sortable` + 拖拽把手 + ↑/↓；现有乐观更新/回滚逻辑（`orderedItems = previous`）原样保留。
- **不可排序时的明确提示**：选「全部」/搜索/筛选时显示「已筛选视图不支持拖拽排序，选择单个分类即可拖拽」；超 500 条的分类显示现有 sortLimit 文案。
- **批量移动**：选择栏（`content-selection-bar`）加同类型分类下拉 + 「移动到分类」按钮 → JSON PATCH `/api/admin/items/bulk` `{action:'move', ids, categoryId}` → `invalidateAll()` + 状态提示。

### C. 分类管理页 `src/routes/admin/categories/+page.svelte` + `CategoryTreeNode.svelte`

- 节点加可选 `sortable` 区块：拖拽把手 + ↑/↓（沿用 AdminContentRow 同款 aria 模式），仅受管类型（`isManagedCategoryType`，遗留类型不参与）。
- 父页面从树数据定位兄弟数组（同 parent 的 children 或顶层 roots），↑/↓/拖放 → `moveOrderedItem` 本地重排 → PUT 全量兄弟 id 列表 → 成功 `invalidateAll()`，失败回滚原树 + 错误提示。

### D. 操作反馈（3 个页面）

- items/categories/home-modules：load 把 `?created=1/?updated=1/?deleted=1` 读进 data.flash，页面顶部渲染一条 `admin-form-message` 状态行（「已创建分类」「已删除内容」等）。items 的弹窗保存路径加客户端即时提示。

### E. 测试与文档（仓库门禁要求）

- 新增 `src/lib/server/services/category-order.spec.ts`（全量范围原子重排 / 拒绝缺漏重复 id / 兄弟作用域隔离，照抄 content-order.spec 结构）。
- 更新 `admin-productization.spec.ts`：删除 sort-mode 旧标记（`sortingMode`、`进入排序` 等），改为断言新行为（分类侧栏、浏览态可拖拽、bulk move、分类节点拖拽把手）。
- 更新 `admin-content.spec.ts`（orderComplete 新条件）、`admin-content-ordering` 相关断言。
- 更新 `scripts/admin-workspace-smoke.mjs`：排序流程改为「点分类 → 直接点 ↓/拖拽 → 顺序已保存」；新增 bulk move 流程与分类 ↑/↓ 排序断言；删除 `mode=sort` URL 矩阵项。
- `docs/development-progress.md` 加一条改造记录（仓库惯例）。

### F. 工作区协调

当前工作区有上一轮审核修复（未提交，全部门禁已绿）。实施时**先**把这些以独立 commit 提交到新分支（如 `fix/audit-remediation`），**再**基于它开 `feat/admin-content-drag` 分支做本功能——两件事不混在一个提交里。

## 复用清单

- `moveOrderedItem`（src/lib/content-ordering.ts）——条目与分类拖拽共用
- `reorderItems`/`content-order.ts`——category-order.ts 的模板
- `AdminContentRow.svelte` 拖拽把手/↑↓ 按钮、`content-ordering.css` 样式
- `mutationApiError`（admin-mutations.ts）错误映射、`isManagedCategoryType`（category-types.ts）
- 现有乐观更新 + 回滚模式（items +page.svelte:159-200）

## 验证

1. `npm run lint && npm run check && npm run test` 全绿
2. `npm run build` 通过
3. `npm run test:admin-workspace`（Playwright 152 布局冒烟，仓库指定的后台回归门禁）
4. 浏览器实测（sctl 控制本地 wrangler 实例）：选分类直接拖拽排序刷新后持久；分类树 ↑/↓ 持久；批量移动到分类生效；不可排序视图有提示；320px 移动端与深色主题无破版
