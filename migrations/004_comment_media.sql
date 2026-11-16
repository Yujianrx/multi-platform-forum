ALTER TABLE attachments ADD COLUMN purpose text NOT NULL DEFAULT 'content' CHECK(purpose IN ('content','comment'));
CREATE TABLE comment_attachments (
  comment_id text NOT NULL REFERENCES comments(id),
  attachment_id text NOT NULL UNIQUE REFERENCES attachments(id),
  PRIMARY KEY(comment_id,attachment_id)
);
CREATE INDEX attachments_comment_drafts ON attachments(content_id,owner_id) WHERE purpose='comment' AND NOT deleted;
UPDATE settings SET value=jsonb_set(value,'{allowedTypes}',value->'allowedTypes'||'["gif","pdf","docx","xlsx","pptx"]'::jsonb) WHERE key='site' AND value->'allowedTypes'='["png","jpg","jpeg","webp","txt","md","json","csv","zip"]'::jsonb;
