ALTER TABLE users ADD COLUMN phone_e164 text CHECK (phone_e164 ~ '^\+[1-9][0-9]{7,14}$');
CREATE UNIQUE INDEX users_phone_unique_idx ON users(phone_e164) WHERE phone_e164 IS NOT NULL;

ALTER TABLE mini_identities ADD COLUMN binding_method text NOT NULL DEFAULT 'pairing'
  CHECK (binding_method IN ('pairing','phone'));
