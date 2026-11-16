ALTER TABLE contents DROP CONSTRAINT contents_type_check;
ALTER TABLE contents ADD CONSTRAINT contents_type_check CHECK(type IN ('experience','project','skill','prompt','discussion'));
CREATE TABLE forum_topics (
  content_id text PRIMARY KEY REFERENCES contents(id),
  kind text NOT NULL DEFAULT 'discussion' CHECK(kind IN ('discussion','question','feedback','chat')),
  related_content_id text REFERENCES contents(id),
  locked boolean NOT NULL DEFAULT false,
  resolved boolean NOT NULL DEFAULT false,
  accepted_comment_id text REFERENCES comments(id),
  CHECK(related_content_id IS NULL OR related_content_id<>content_id)
);
CREATE INDEX forum_related_idx ON forum_topics(related_content_id);
CREATE TABLE forum_subscriptions (
  content_id text NOT NULL REFERENCES forum_topics(content_id),
  user_id text NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(content_id,user_id)
);
CREATE TABLE forum_visits (
  content_id text NOT NULL REFERENCES forum_topics(content_id),
  user_id text NOT NULL REFERENCES users(id),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(content_id,user_id)
);
