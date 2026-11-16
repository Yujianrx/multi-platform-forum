ALTER TABLE departments ADD COLUMN sort_order integer NOT NULL DEFAULT 1000;

UPDATE departments SET name='设计部' WHERE name='产品与设计部' AND NOT EXISTS(SELECT 1 FROM departments WHERE name='设计部');
UPDATE departments SET name='研发中心' WHERE name='技术研发部' AND NOT EXISTS(SELECT 1 FROM departments WHERE name='研发中心');
UPDATE departments SET name='营运中心' WHERE name='业务运营部' AND NOT EXISTS(SELECT 1 FROM departments WHERE name='营运中心');

INSERT INTO departments(id,name,sort_order) VALUES
('bc35b8b5-6fef-42fb-8fe0-26720c30acc5','总经办',0),
('6106487f-affa-41c5-bfe7-8dc8a27f123b','海外及大客户服务中心',1),
('50886b6d-d1a9-4abb-9ed6-8ccae217d72c','品牌中心',2),
('24788e8b-721f-4c45-938d-b4a472051488','设计部',3),
('9e7bdf34-96ce-4893-a766-8629eb8c7b49','供应链中心',4),
('30987501-6c4e-47cb-8234-e4b022ea6959','营运中心',5),
('f4e6bce7-6715-4b8b-9f0e-6b12bdd6eb27','财务部',6),
('fee8fd9b-da2c-4b83-9b9e-39c75547f755','人力行政部',7),
('01a1a4f1-625b-482c-a209-5773623c3a9d','招商中心',8),
('2a05f04f-9ae4-4d72-8021-253aff046e93','外卖运营部',9),
('ab6a28d3-f8e9-475a-b571-34676b3f082b','工程部',10),
('2b4b2a93-27c0-4b09-a9e4-f1f317e839a8','研发中心',11),
('9cf0b672-414a-459f-8ae2-b8dc83661b65','团购运营',12)
ON CONFLICT(name) DO UPDATE SET sort_order=EXCLUDED.sort_order;
