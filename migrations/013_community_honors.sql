ALTER TABLE contents ADD COLUMN honors_eligible boolean NOT NULL DEFAULT false;
ALTER TABLE contents ALTER COLUMN honors_eligible SET DEFAULT true;
ALTER TABLE comments ADD COLUMN honors_eligible boolean NOT NULL DEFAULT false;
ALTER TABLE comments ALTER COLUMN honors_eligible SET DEFAULT true;
ALTER TABLE attachments ADD COLUMN content_hash text;
ALTER TABLE forum_topics ADD COLUMN accepted_by text REFERENCES users(id);
ALTER TABLE forum_topics ADD COLUMN accepted_at timestamptz;
INSERT INTO settings(key,value) VALUES('honors',jsonb_build_object('version',1,'enabledAt',now(),'points',20,'weeklyLimit',3,'timezone','Asia/Shanghai','levels','[{"name":"共创新人","points":0},{"name":"实践新秀","points":60},{"name":"分享达人","points":180},{"name":"共创骨干","points":420},{"name":"共创先锋","points":900},{"name":"共创领航者","points":1800}]'::jsonb));
CREATE TABLE contributions (
 id text PRIMARY KEY, user_id text NOT NULL REFERENCES users(id), category text NOT NULL CHECK(category IN ('case','resource','answer')),
 content_id text NOT NULL REFERENCES contents(id), comment_id text UNIQUE REFERENCES comments(id), revision_id text REFERENCES revisions(id),
 qualification text NOT NULL DEFAULT 'pending' CHECK(qualification IN ('pending','confirmed','rejected')),
 valid boolean NOT NULL DEFAULT false, reason text NOT NULL DEFAULT '等待贡献资格确认', assessment_reason text NOT NULL DEFAULT '',
 assessed_by text REFERENCES users(id), assessed_at timestamptz, first_valid_at timestamptz, week_start date,
 fingerprint text NOT NULL, file_hashes jsonb NOT NULL DEFAULT '[]', rule_version int NOT NULL DEFAULT 1,
 points int NOT NULL DEFAULT 0 CHECK(points IN (0,20)), transition int NOT NULL DEFAULT 0,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK((category='answer')=(comment_id IS NOT NULL))
);
CREATE UNIQUE INDEX contributions_content ON contributions(content_id) WHERE comment_id IS NULL;
CREATE INDEX contributions_week ON contributions(user_id,week_start,category,first_valid_at,id);
CREATE INDEX contributions_fingerprint ON contributions(fingerprint);
CREATE TABLE contribution_signatures(contribution_id text REFERENCES contributions(id),kind text NOT NULL,value text NOT NULL,PRIMARY KEY(contribution_id,kind,value));
CREATE INDEX contribution_signatures_value ON contribution_signatures(kind,value);
CREATE TABLE points_ledger (
 id text PRIMARY KEY, contribution_id text NOT NULL REFERENCES contributions(id), user_id text NOT NULL REFERENCES users(id),
 category text NOT NULL, delta int NOT NULL CHECK(delta IN (-20,20)), week_start date NOT NULL,
 reason text NOT NULL, actor_id text REFERENCES users(id), operation_key text NOT NULL UNIQUE,
 reverses_id text UNIQUE REFERENCES points_ledger(id), rule_version int NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX points_ledger_user ON points_ledger(user_id,created_at DESC);
CREATE TABLE weekly_contribution_buckets (
 user_id text REFERENCES users(id), week_start date, category text, counted int NOT NULL CHECK(counted BETWEEN 0 AND 3),
 points int NOT NULL CHECK(points BETWEEN 0 AND 60), PRIMARY KEY(user_id,week_start,category)
);
CREATE TABLE leaderboard_periods (
 id text PRIMARY KEY, week_start date NOT NULL, version int NOT NULL, digest text NOT NULL,
 reason text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(week_start,version)
);
CREATE TABLE leaderboard_entries (
 period_id text REFERENCES leaderboard_periods(id), board text NOT NULL, user_id text REFERENCES users(id),
 points int NOT NULL CHECK(points>0), rank int NOT NULL, PRIMARY KEY(period_id,board,user_id)
);
CREATE TABLE badge_definitions (id text PRIMARY KEY,name text NOT NULL,condition text NOT NULL,mode text NOT NULL CHECK(mode IN ('auto','manual')),image text NOT NULL,position int NOT NULL);
INSERT INTO badge_definitions VALUES
 ('first-case','首次分享案例','首篇原创实用案例成为有效贡献','auto','/brand/badges/first-case.webp',1),
 ('first-resource','首次分享资源','首份完整可用的项目或资源成为有效贡献','auto','/brand/badges/first-resource.webp',2),
 ('first-answer','首次解答被采纳','首条审核通过的回答被提问者采纳，且非自问自答','auto','/brand/badges/first-answer.webp',3),
 ('all-round','全能共创者','案例、资源、答疑三类各至少一次有效贡献','auto','/brand/badges/all-round.webp',4),
 ('consistent','持续共创者','历史上任意连续四个北京时间自然周均有有效贡献','auto','/brand/badges/consistent.webp',5),
 ('quality','优质贡献者','由管理员评选授予，并记录理由','manual','/brand/badges/quality.webp',6);
CREATE TABLE badge_awards (
 id text PRIMARY KEY, user_id text NOT NULL REFERENCES users(id), badge_id text NOT NULL REFERENCES badge_definitions(id),
 awarded_at timestamptz NOT NULL DEFAULT now(), awarded_by text REFERENCES users(id), reason text NOT NULL,
 evidence jsonb NOT NULL DEFAULT '[]', needs_review boolean NOT NULL DEFAULT false,
 revoked_at timestamptz, revoke_reason text NOT NULL DEFAULT '', revoked_by text REFERENCES users(id)
);
CREATE UNIQUE INDEX badge_active ON badge_awards(user_id,badge_id) WHERE revoked_at IS NULL;
