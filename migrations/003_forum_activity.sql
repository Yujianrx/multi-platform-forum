ALTER TABLE comments ADD COLUMN approved_at timestamptz;
ALTER TABLE revisions ADD COLUMN approved_at timestamptz;
UPDATE comments SET approved_at=created_at WHERE status='approved';
UPDATE revisions SET approved_at=created_at WHERE status='approved';
CREATE INDEX forum_reply_activity_idx ON comments(content_id,approved_at DESC) WHERE status='approved';
