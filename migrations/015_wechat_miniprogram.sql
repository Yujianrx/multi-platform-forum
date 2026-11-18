ALTER TABLE sessions ADD COLUMN mini_app_id text;

CREATE INDEX sessions_mini_user_idx ON sessions(user_id,mini_app_id) WHERE mini_app_id IS NOT NULL;

CREATE TABLE mini_identities (
  app_id text NOT NULL,
  identity_hash text NOT NULL,
  user_id text REFERENCES users(id),
  code_hash text UNIQUE,
  expires_at timestamptz,
  PRIMARY KEY (app_id,identity_hash),
  UNIQUE (app_id,user_id)
);
