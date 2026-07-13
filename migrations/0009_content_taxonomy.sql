-- Productized child taxonomy and verified official content. Safe to run repeatedly.
INSERT INTO categories(type,parent_id,name,slug,icon,description,sort_order,is_visible) VALUES
('site',(SELECT id FROM categories WHERE type='site' AND slug='dev-tools'),'代码托管','code-hosting','git-branch','代码仓库、协作与持续集成平台',21,1),
('site',(SELECT id FROM categories WHERE type='site' AND slug='dev-tools'),'前端开发','frontend-dev','code','前端文档、框架与构建工具',22,1),
('site',(SELECT id FROM categories WHERE type='site' AND slug='dev-tools'),'容器部署','containers-devops','server','容器、镜像与应用交付工具',23,1),
('site',(SELECT id FROM categories WHERE type='site' AND slug='design'),'设计协作','design-collaboration','palette','界面设计、原型与团队协作',31,1),
('site',(SELECT id FROM categories WHERE type='site' AND slug='design'),'设计社区','design-community','users','作品展示与设计灵感社区',32,1),
('site',(SELECT id FROM categories WHERE type='site' AND slug='design'),'视觉素材','visual-assets','image','配色、图标与视觉素材工具',33,1),
('app',(SELECT id FROM categories WHERE type='app' AND slug='productivity'),'代码编辑','code-editors','code','跨平台代码编辑与开发环境',41,1),
('app',(SELECT id FROM categories WHERE type='app' AND slug='productivity'),'知识管理','knowledge-management','book','笔记、文档与个人知识库',42,1),
('app',(SELECT id FROM categories WHERE type='app' AND slug='productivity'),'快捷启动','app-launchers','zap','应用启动、搜索与快捷操作',43,1),
('app',(SELECT id FROM categories WHERE type='app' AND slug='productivity'),'任务协作','task-collaboration','check','任务规划与团队协作工具',44,1)
ON CONFLICT(type,slug) DO UPDATE SET parent_id=excluded.parent_id,name=excluded.name,icon=excluded.icon,description=excluded.description,sort_order=excluded.sort_order,is_visible=1;

UPDATE items SET category_id=(SELECT id FROM categories WHERE type='site' AND slug='code-hosting') WHERE type='site' AND slug='github';
UPDATE items SET category_id=(SELECT id FROM categories WHERE type='site' AND slug='frontend-dev') WHERE type='site' AND slug='svelte';
UPDATE items SET category_id=(SELECT id FROM categories WHERE type='site' AND slug='design-collaboration') WHERE type='site' AND slug='figma';
UPDATE items SET category_id=(SELECT id FROM categories WHERE type='app' AND slug='code-editors') WHERE type='app' AND slug='visual-studio-code';

INSERT INTO items(type,category_id,title,slug,summary,content,status,visibility,sort_order,is_featured,published_at) VALUES
('site',(SELECT id FROM categories WHERE type='site' AND slug='containers-devops'),'Docker','docker','构建、共享和运行容器化应用的平台。','Docker提供容器镜像、开发工具和运行环境，用于在不同机器与部署环境之间保持一致的应用交付流程。','published','public',101,0,CURRENT_TIMESTAMP),
('site',(SELECT id FROM categories WHERE type='site' AND slug='frontend-dev'),'MDN Web Docs','mdn-web-docs','面向Web开发者的开放技术文档。','MDN Web Docs整理HTML、CSS、JavaScript和Web API参考，是学习与查询开放Web技术的长期入口。','published','public',102,0,CURRENT_TIMESTAMP),
('site',(SELECT id FROM categories WHERE type='site' AND slug='frontend-dev'),'Vite','vite','快速的现代前端构建工具。','Vite提供开发服务器和生产构建能力，服务于现代JavaScript与TypeScript前端项目。','published','public',103,0,CURRENT_TIMESTAMP),
('site',(SELECT id FROM categories WHERE type='site' AND slug='design-community'),'Dribbble','dribbble','设计师展示作品和发现灵感的社区。','Dribbble汇集界面、品牌、插画和动效等设计作品，可用于浏览创意案例与设计趋势。','published','public',111,0,CURRENT_TIMESTAMP),
('site',(SELECT id FROM categories WHERE type='site' AND slug='visual-assets'),'Coolors','coolors','快速生成和整理配色方案的工具。','Coolors用于生成、调整和导出颜色组合，适合界面、品牌和视觉项目的配色探索。','published','public',112,0,CURRENT_TIMESTAMP),
('site',(SELECT id FROM categories WHERE type='site' AND slug='visual-assets'),'Font Awesome','font-awesome','常用图标库与图标工具集。','Font Awesome提供可用于网页和应用界面的图标资源及相关开发工具。','published','public',113,0,CURRENT_TIMESTAMP),
('app',(SELECT id FROM categories WHERE type='app' AND slug='knowledge-management'),'Notion','notion','集文档、知识库和项目协作于一体的工作空间。','Notion支持文档、数据库、知识库和团队协作，可用于集中管理项目与信息。','published','public',121,0,CURRENT_TIMESTAMP),
('app',(SELECT id FROM categories WHERE type='app' AND slug='knowledge-management'),'Obsidian','obsidian','基于本地Markdown文件的知识库应用。','Obsidian围绕本地Markdown笔记建立链接、图谱和可扩展的个人知识管理工作流。','published','public',122,0,CURRENT_TIMESTAMP),
('app',(SELECT id FROM categories WHERE type='app' AND slug='app-launchers'),'Raycast','raycast','面向macOS的快捷启动与效率工具。','Raycast通过命令面板、扩展和自动化入口帮助用户快速启动应用、搜索内容和执行操作。','published','public',123,0,CURRENT_TIMESTAMP),
('app',(SELECT id FROM categories WHERE type='app' AND slug='task-collaboration'),'Todoist','todoist','跨平台任务与待办事项管理工具。','Todoist支持任务、项目、优先级和协作，可用于个人规划和团队任务跟踪。','published','public',124,0,CURRENT_TIMESTAMP),
('app',(SELECT id FROM categories WHERE type='app' AND slug='task-collaboration'),'Linear','linear','面向产品与软件团队的问题跟踪工具。','Linear提供问题、项目和产品规划工作流，帮助软件团队管理开发任务和发布进度。','published','public',125,0,CURRENT_TIMESTAMP)
ON CONFLICT(type,slug) DO UPDATE SET category_id=excluded.category_id,title=excluded.title,summary=excluded.summary,content=excluded.content,status='published',visibility='public',sort_order=excluded.sort_order;

INSERT INTO item_meta(item_id,meta_key,meta_value) VALUES
((SELECT id FROM items WHERE type='site' AND slug='docker'),'site_url','https://www.docker.com'),
((SELECT id FROM items WHERE type='site' AND slug='mdn-web-docs'),'site_url','https://developer.mozilla.org'),
((SELECT id FROM items WHERE type='site' AND slug='vite'),'site_url','https://vite.dev'),
((SELECT id FROM items WHERE type='site' AND slug='dribbble'),'site_url','https://dribbble.com'),
((SELECT id FROM items WHERE type='site' AND slug='coolors'),'site_url','https://coolors.co'),
((SELECT id FROM items WHERE type='site' AND slug='font-awesome'),'site_url','https://fontawesome.com'),
((SELECT id FROM items WHERE type='app' AND slug='notion'),'app_download_url','https://www.notion.com'),
((SELECT id FROM items WHERE type='app' AND slug='obsidian'),'app_download_url','https://obsidian.md'),
((SELECT id FROM items WHERE type='app' AND slug='raycast'),'app_download_url','https://www.raycast.com'),
((SELECT id FROM items WHERE type='app' AND slug='todoist'),'app_download_url','https://www.todoist.com'),
((SELECT id FROM items WHERE type='app' AND slug='linear'),'app_download_url','https://linear.app')
ON CONFLICT(item_id,meta_key) DO UPDATE SET meta_value=excluded.meta_value;

INSERT INTO item_meta(item_id,meta_key,meta_value) VALUES
((SELECT id FROM items WHERE type='app' AND slug='notion'),'app_platform','Web, Windows, macOS, iOS, Android'),
((SELECT id FROM items WHERE type='app' AND slug='obsidian'),'app_platform','Windows, macOS, Linux, iOS, Android'),
((SELECT id FROM items WHERE type='app' AND slug='raycast'),'app_platform','macOS'),
((SELECT id FROM items WHERE type='app' AND slug='todoist'),'app_platform','Web, Windows, macOS, Linux, iOS, Android'),
((SELECT id FROM items WHERE type='app' AND slug='linear'),'app_platform','Web, Windows, macOS, iOS, Android')
ON CONFLICT(item_id,meta_key) DO UPDATE SET meta_value=excluded.meta_value;
