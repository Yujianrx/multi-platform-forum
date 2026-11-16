CREATE TABLE login_captchas(id text PRIMARY KEY,binding_hash text NOT NULL,answer_digest text NOT NULL,expires_at timestamptz NOT NULL);
CREATE INDEX login_captchas_expiry ON login_captchas(expires_at);
CREATE INDEX login_captchas_binding ON login_captchas(binding_hash);
