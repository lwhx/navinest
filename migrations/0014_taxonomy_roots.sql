-- Ensure the required taxonomy roots exist before repairing child categories created by 0009.
INSERT INTO categories(type,parent_id,name,slug,icon,description,sort_order,is_visible) VALUES
('site',NULL,'常用推荐','favorites','star','日常高频访问入口',10,1),
('site',NULL,'开发工具','dev-tools','code','开发、调试、部署相关工具',20,1),
('site',NULL,'设计资源','design','palette','设计灵感与素材资源',30,1),
('app',NULL,'效率工具','productivity','app','提升效率的软件与资源',40,1),
('book',NULL,'书籍影视','bookshelf','book','书籍、影视和资料收藏',50,1),
('post',NULL,'文章摘录','notes','file','产品、开发和设计记录',60,1),
('bulletin',NULL,'站点公告','announcements','bell','NaviNest 更新与维护公告',70,1)
ON CONFLICT(type,slug) DO UPDATE SET name=excluded.name,icon=excluded.icon,description=excluded.description,sort_order=excluded.sort_order,is_visible=1;

UPDATE categories SET parent_id=(SELECT id FROM categories WHERE type='site' AND slug='dev-tools')
WHERE type='site' AND slug IN ('code-hosting','frontend-dev','containers-devops');
UPDATE categories SET parent_id=(SELECT id FROM categories WHERE type='site' AND slug='design')
WHERE type='site' AND slug IN ('design-collaboration','design-community','visual-assets');
UPDATE categories SET parent_id=(SELECT id FROM categories WHERE type='app' AND slug='productivity')
WHERE type='app' AND slug IN ('code-editors','knowledge-management','app-launchers','task-collaboration');
