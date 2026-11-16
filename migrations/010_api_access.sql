CREATE TABLE api_keys (
 id text PRIMARY KEY,
 user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 name text NOT NULL,
 token_hash text NOT NULL UNIQUE,
 prefix text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz NOT NULL,
 revoked_at timestamptz,
 last_used_at timestamptz
);
CREATE INDEX api_keys_user ON api_keys(user_id,created_at DESC);
CREATE TABLE api_posts (
 content_id text PRIMARY KEY REFERENCES contents(id),
 user_id text NOT NULL REFERENCES users(id),
 api_key_id text NOT NULL REFERENCES api_keys(id),
 idempotency_key text NOT NULL,
 request_digest text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(user_id,idempotency_key)
);
CREATE INDEX api_posts_user_created ON api_posts(user_id,created_at DESC);
