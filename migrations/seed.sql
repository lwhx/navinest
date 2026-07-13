INSERT INTO categories (id, type, parent_id, name, slug, icon, description, sort_order) VALUES
	(1, 'site', NULL, '常用推荐', 'favorites', 'star', '日常高频访问入口', 10),
	(2, 'site', NULL, '开发工具', 'dev-tools', 'code', '开发、调试、部署相关工具', 20),
	(3, 'site', NULL, '设计资源', 'design', 'palette', '设计灵感与素材资源', 30),
	(4, 'app', NULL, '效率工具', 'productivity', 'app', '提升效率的软件与资源', 40),
	(5, 'book', NULL, '书籍影视', 'bookshelf', 'book', '书籍、影视和资料收藏', 50),
	(6, 'post', NULL, '文章摘录', 'notes', 'file', '产品、开发和设计记录', 60),
	(7, 'bulletin', NULL, '站点公告', 'announcements', 'bell', 'NaviNest 更新与维护公告', 70);

INSERT INTO tags (id, type, name, slug) VALUES
	(1, 'site', 'Cloudflare', 'cloudflare'),
	(2, 'site', '开发', 'dev'),
	(3, 'site', '设计', 'design'),
	(4, 'app', '效率', 'productivity'),
	(5, 'book', '阅读', 'reading'),
	(6, 'post', '笔记', 'notes'),
	(7, 'bulletin', '更新', 'update');

INSERT INTO items (id, type, category_id, title, slug, summary, content, status, sort_order, is_featured, published_at) VALUES
	(1, 'site', 1, 'Cloudflare Dashboard', 'cloudflare-dashboard', '管理 Workers、D1、R2 和域名配置。', 'Cloudflare Dashboard 是 NaviNest 部署、数据库、对象存储和域名配置的统一管理入口。', 'published', 10, 1, CURRENT_TIMESTAMP),
	(2, 'site', 2, 'GitHub', 'github', '代码托管、Issues 和 Actions 工作流。', 'GitHub 用于托管代码、跟踪任务，并通过 Actions 执行持续集成和部署流程。', 'published', 20, 1, CURRENT_TIMESTAMP),
	(3, 'site', 2, 'Svelte', 'svelte', '构建 NaviNest 前端体验的核心框架。', 'SvelteKit 负责 NaviNest 的页面路由、服务端数据加载和 Cloudflare Worker 构建。', 'published', 30, 0, CURRENT_TIMESTAMP),
	(4, 'site', 3, 'Figma', 'figma', '界面设计、原型和视觉资产协作。', 'Figma 用于梳理界面结构、交互原型和视觉资产。', 'published', 40, 0, CURRENT_TIMESTAMP),
	(5, 'app', 4, 'Visual Studio Code', 'visual-studio-code', '轻量但强大的代码编辑器。', 'Visual Studio Code 提供跨平台编辑、调试和扩展能力。', 'published', 50, 0, CURRENT_TIMESTAMP),
	(6, 'book', 5, 'The Design of Everyday Things', 'design-of-everyday-things', '关于可用性和产品设计的经典读物。', 'Don Norman 从日常物品出发，解释可见性、反馈、约束和概念模型如何影响产品可用性。', 'published', 60, 0, CURRENT_TIMESTAMP),
	(7, 'post', 6, '构建一个安静的起点', 'building-a-quiet-start-space', '记录 NaviNest 在信息密度、导航效率和视觉克制之间的设计取舍。', '个人导航首先是重复使用的工作界面。NaviNest 通过稳定分类、紧凑卡片和克制的视觉层级，让高频入口保持清晰，同时为搜索、收藏和内容扩展保留空间。', 'published', 70, 0, CURRENT_TIMESTAMP),
	(8, 'bulletin', 7, 'NaviNest 预览版上线', 'navinest-preview', '导航首页、搜索、分类、标签、详情与安全跳转现已可用。', '当前预览版已完成导航前台的主要浏览流程。Cloudflare 真实资源、后台管理和用户系统将在后续阶段接入。', 'published', 80, 1, CURRENT_TIMESTAMP);

INSERT INTO item_meta (item_id, meta_key, meta_value) VALUES
	(1, 'site_url', 'https://dash.cloudflare.com'),
	(2, 'site_url', 'https://github.com'),
	(3, 'site_url', 'https://svelte.dev'),
	(4, 'site_url', 'https://figma.com'),
	(5, 'site_url', 'https://code.visualstudio.com'),
	(5, 'app_platform', 'Windows, macOS, Linux'),
	(6, 'book_author', 'Don Norman'),
	(6, 'book_download_url', 'https://en.wikipedia.org/wiki/The_Design_of_Everyday_Things');

INSERT INTO item_tags (item_id, tag_id) VALUES
	(1, 1),
	(2, 2),
	(3, 2),
	(4, 3),
	(5, 4),
	(6, 5),
	(7, 6),
	(8, 7);

INSERT INTO search_engines (group_key, name, key, url_template, placeholder, sort_order) VALUES
	('onsite', '站内', 'site', '/search?q={query}', '搜索 NaviNest', 10),
	('general', 'Google', 'google', 'https://www.google.com/search?q={query}', 'Google 搜索', 20),
	('general', 'Bing', 'bing', 'https://www.bing.com/search?q={query}', 'Bing 搜索', 30),
	('dev', 'GitHub', 'github', 'https://github.com/search?q={query}', '搜索 GitHub', 40);

INSERT INTO home_modules (type, title, config_json, sort_order) VALUES
	('search', '聚合搜索', '{"defaultGroup":"onsite"}', 10),
	('content', '常用推荐', '{"type":"site","categorySlug":"favorites","limit":8}', 20),
	('content', '开发工具', '{"type":"site","categorySlug":"dev-tools","limit":8}', 30),
	('ranking', '排行榜', '{"range":"week","type":"site","limit":10}', 40);

INSERT INTO settings (key, value_json) VALUES
	('site', '{"name":"NaviNest","title":"NaviNest 导航巢","url":"https://nss.whks.de"}'),
	('registration', '{"enabled":false}');
