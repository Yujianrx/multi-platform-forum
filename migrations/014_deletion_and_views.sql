ALTER TABLE users ADD COLUMN deleted_at timestamptz;
ALTER TABLE users ADD COLUMN deleted_by text REFERENCES users(id);
ALTER TABLE users ADD CONSTRAINT deleted_users_inactive CHECK(deleted_at IS NULL OR NOT active);
ALTER TABLE revisions ADD COLUMN discarded_at timestamptz;
CREATE TABLE content_view_events (
 content_id text NOT NULL REFERENCES contents(id), user_id text NOT NULL REFERENCES users(id),
 day date NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(content_id,user_id,day)
);
CREATE INDEX content_views_period ON content_view_events(created_at,content_id);
INSERT INTO content_view_events(content_id,user_id,day,created_at)
 SELECT v.content_id,v.user_id,(v.last_seen_at AT TIME ZONE 'Asia/Shanghai')::date,v.last_seen_at
 FROM forum_visits v JOIN contents c ON c.id=v.content_id
 WHERE v.user_id<>c.author_id AND c.state='published'
 ON CONFLICT DO NOTHING;
