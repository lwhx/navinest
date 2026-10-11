-- Idempotent initial content. All relationships use natural keys rather than environment-specific IDs.
INSERT INTO categories(type,parent_id,name,slug,icon,description,sort_order,is_visible) VALUES
('site',NULL,'常用推荐','favorites','star','日常高频访问入口',10,1),
('site',NULL,'开发工具','dev-tools','code','开发、调试、部署相关工具',20,1),
('site',NULL,'设计资源','design','palette','设计灵感与素材资源',30,1),
('app',NULL,'效率工具','productivity','app','提升效率的软件与资源',40,1),
('book',NULL,'书籍影视','bookshelf','book','书籍、影视和资料收藏',50,1),
('post',NULL,'文章摘录','notes','file','产品、开发和设计记录',60,1),
('bulletin',NULL,'站点公告','announcements','bell','NaviNest 更新与维护公告',70,1)
ON CONFLICT(type,slug) DO UPDATE SET parent_id=NULL,name=excluded.name,icon=excluded.icon,description=excluded.description,sort_order=excluded.sort_order,is_visible=1;

INSERT INTO tags(type,name,slug,description) VALUES
('site','Cloudflare','cloudflare',NULL),
('site','开发','dev',NULL),
('site','设计','design',NULL),
('app','效率','productivity',NULL),
('book','阅读','reading',NULL),
('post','笔记','notes',NULL),
('bulletin','更新','update',NULL)
ON CONFLICT(type,slug) DO UPDATE SET name=excluded.name;

INSERT INTO items(type,category_id,title,slug,summary,content,status,visibility,sort_order,is_featured,published_at) VALUES
('site',(SELECT id FROM categories WHERE type='site' AND slug='favorites'),'Cloudflare Dashboard','cloudflare-dashboard','管理 Workers、D1、R2 和域名配置。','Cloudflare Dashboard 是 NaviNest 部署、数据库、对象存储和域名配置的统一管理入口。','published','public',10,1,CURRENT_TIMESTAMP),
('site',(SELECT id FROM categories WHERE type='site' AND slug='dev-tools'),'GitHub','github','代码托管、Issues 和 Actions 工作流。','GitHub 用于托管代码、跟踪任务，并通过 Actions 执行持续集成和部署流程。','published','public',20,1,CURRENT_TIMESTAMP),
('site',(SELECT id FROM categories WHERE type='site' AND slug='dev-tools'),'Svelte','svelte','构建 NaviNest 前端体验的核心框架。','SvelteKit 负责 NaviNest 的页面路由、服务端数据加载和 Cloudflare Worker 构建。','published','public',30,0,CURRENT_TIMESTAMP),
('site',(SELECT id FROM categories WHERE type='site' AND slug='design'),'Figma','figma','界面设计、原型和视觉资产协作。','Figma 用于梳理界面结构、交互原型和视觉资产。','published','public',40,0,CURRENT_TIMESTAMP),
('app',(SELECT id FROM categories WHERE type='app' AND slug='productivity'),'Visual Studio Code','visual-studio-code','轻量但强大的代码编辑器。','Visual Studio Code 提供跨平台编辑、调试和扩展能力。','published','public',50,0,CURRENT_TIMESTAMP),
('book',(SELECT id FROM categories WHERE type='book' AND slug='bookshelf'),'The Design of Everyday Things','design-of-everyday-things','关于可用性和产品设计的经典读物。','Don Norman 从日常物品出发，解释可见性、反馈、约束和概念模型如何影响产品可用性。','published','public',60,0,CURRENT_TIMESTAMP),
('post',(SELECT id FROM categories WHERE type='post' AND slug='notes'),'构建一个安静的起点','building-a-quiet-start-space','记录 NaviNest 在信息密度、导航效率和视觉克制之间的设计取舍。','个人导航首先是重复使用的工作界面。NaviNest 通过稳定分类、紧凑卡片和克制的视觉层级，让高频入口保持清晰，同时为搜索、收藏和内容扩展保留空间。','published','public',70,0,CURRENT_TIMESTAMP),
('bulletin',(SELECT id FROM categories WHERE type='bulletin' AND slug='announcements'),'NaviNest 预览版上线','navinest-preview','导航首页、搜索、分类、标签、详情与安全跳转现已可用。','当前预览版已完成导航前台的主要浏览流程。Cloudflare 真实资源、后台管理和用户系统将在后续阶段接入。','published','public',80,1,CURRENT_TIMESTAMP)
ON CONFLICT(type,slug) DO UPDATE SET category_id=excluded.category_id,title=excluded.title,summary=excluded.summary,content=excluded.content,status='published',visibility='public',sort_order=excluded.sort_order,is_featured=excluded.is_featured;

INSERT INTO item_meta(item_id,meta_key,meta_value) VALUES
((SELECT id FROM items WHERE type='site' AND slug='cloudflare-dashboard'),'site_url','https://dash.cloudflare.com'),
((SELECT id FROM items WHERE type='site' AND slug='github'),'site_url','https://github.com'),
((SELECT id FROM items WHERE type='site' AND slug='svelte'),'site_url','https://svelte.dev'),
((SELECT id FROM items WHERE type='site' AND slug='figma'),'site_url','https://figma.com'),
((SELECT id FROM items WHERE type='app' AND slug='visual-studio-code'),'app_download_url','https://code.visualstudio.com'),
((SELECT id FROM items WHERE type='app' AND slug='visual-studio-code'),'app_platform','Windows, macOS, Linux'),
((SELECT id FROM items WHERE type='book' AND slug='design-of-everyday-things'),'book_author','Don Norman'),
((SELECT id FROM items WHERE type='book' AND slug='design-of-everyday-things'),'book_download_url','https://en.wikipedia.org/wiki/The_Design_of_Everyday_Things')
ON CONFLICT(item_id,meta_key) DO UPDATE SET meta_value=excluded.meta_value;

INSERT INTO item_tags(item_id,tag_id) VALUES
((SELECT id FROM items WHERE type='site' AND slug='cloudflare-dashboard'),(SELECT id FROM tags WHERE type='site' AND slug='cloudflare')),
((SELECT id FROM items WHERE type='site' AND slug='github'),(SELECT id FROM tags WHERE type='site' AND slug='dev')),
((SELECT id FROM items WHERE type='site' AND slug='svelte'),(SELECT id FROM tags WHERE type='site' AND slug='dev')),
((SELECT id FROM items WHERE type='site' AND slug='figma'),(SELECT id FROM tags WHERE type='site' AND slug='design')),
((SELECT id FROM items WHERE type='app' AND slug='visual-studio-code'),(SELECT id FROM tags WHERE type='app' AND slug='productivity')),
((SELECT id FROM items WHERE type='book' AND slug='design-of-everyday-things'),(SELECT id FROM tags WHERE type='book' AND slug='reading')),
((SELECT id FROM items WHERE type='post' AND slug='building-a-quiet-start-space'),(SELECT id FROM tags WHERE type='post' AND slug='notes')),
((SELECT id FROM items WHERE type='bulletin' AND slug='navinest-preview'),(SELECT id FROM tags WHERE type='bulletin' AND slug='update'))
ON CONFLICT(item_id,tag_id) DO NOTHING;

INSERT INTO search_engines(group_key,name,key,url_template,placeholder,sort_order,is_enabled) VALUES
('onsite','站内','site','/search?q={query}','搜索 NaviNest',10,1),
('general','Google','google','https://www.google.com/search?q={query}','Google 搜索',20,1),
('general','Bing','bing','https://www.bing.com/search?q={query}','Bing 搜索',30,1),
('dev','GitHub','github','https://github.com/search?q={query}','搜索 GitHub',40,1)
ON CONFLICT(key) DO UPDATE SET group_key=excluded.group_key,name=excluded.name,url_template=excluded.url_template,placeholder=excluded.placeholder,sort_order=excluded.sort_order,is_enabled=1;

INSERT INTO home_modules(type,title,config_json,sort_order,is_enabled)
SELECT 'search','聚合搜索','{"defaultGroup":"onsite"}',10,1 WHERE NOT EXISTS(SELECT 1 FROM home_modules WHERE type='search' AND title='聚合搜索');
INSERT INTO home_modules(type,title,config_json,sort_order,is_enabled)
SELECT 'content','常用推荐','{"type":"site","categorySlug":"favorites","limit":8}',20,1 WHERE NOT EXISTS(SELECT 1 FROM home_modules WHERE type='content' AND title='常用推荐');
INSERT INTO home_modules(type,title,config_json,sort_order,is_enabled)
SELECT 'content','开发工具','{"type":"site","categorySlug":"dev-tools","limit":8}',30,1 WHERE NOT EXISTS(SELECT 1 FROM home_modules WHERE type='content' AND title='开发工具');
INSERT INTO home_modules(type,title,config_json,sort_order,is_enabled)
SELECT 'ranking','排行榜','{"range":"week","type":"site","limit":10}',100,1 WHERE NOT EXISTS(SELECT 1 FROM home_modules WHERE type='ranking' AND title='排行榜');

INSERT INTO settings(key,value_json) VALUES
('site','{"name":"NaviNest","title":"NaviNest 导航巢","url":"https://nss.whks.de"}'),
('registration','{"enabled":false}')
ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json;
