ALTER TABLE users ADD COLUMN avatar_version uuid;
CREATE TABLE user_avatars (
  user_id text PRIMARY KEY REFERENCES users(id),
  data text,
  pending_data text,
  pending_version uuid,
  status text NOT NULL DEFAULT 'approved' CHECK(status IN ('approved','review','rejected')),
  reason text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now()
);

