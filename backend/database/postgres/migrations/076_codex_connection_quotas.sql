-- What the Codex app server last reported about the general Codex quota of a
-- Codex connection signed in with ChatGPT. codex_connection_quotas holds one
-- row per connection that was queried successfully: observed_at is the time
-- of that answer, also when the answer held no window. plan is the
-- subscription named by the reported plan type (free, go, plus, pro, prolite,
-- promax, team, business, enterprise or edu), NULL when the answer named none
-- or none that is known; it is never inferred. is_limit_reached is the
-- account's own statement that its limit is reached and never changes the
-- stored windows. codex_connection_quota_windows holds one row per window the
-- answer reported: primary or secondary with the used share in whole percent
-- (0 to 100) as reported, the length of the window in minutes and its reset.
-- A window the answer did not report has no row; it is never stored as 0.
-- duration_minutes and resets_at are NULL when the answer named none. Times
-- are ISO 8601 in UTC. Both tables follow the connection when it is removed.
CREATE TABLE codex_connection_quotas (
    connection_id TEXT NOT NULL REFERENCES agent_connections (id) ON DELETE CASCADE,
    plan TEXT,
    is_limit_reached BOOLEAN NOT NULL,
    observed_at TEXT NOT NULL,
    PRIMARY KEY (connection_id),
    CHECK (plan IN ('free', 'go', 'plus', 'pro', 'prolite', 'promax', 'team', 'business', 'enterprise', 'edu'))
);

CREATE TABLE codex_connection_quota_windows (
    connection_id TEXT NOT NULL REFERENCES codex_connection_quotas (connection_id) ON DELETE CASCADE,
    window_kind TEXT NOT NULL,
    used_percent INTEGER NOT NULL,
    duration_minutes BIGINT,
    resets_at TEXT,
    PRIMARY KEY (connection_id, window_kind),
    CHECK (window_kind IN ('primary', 'secondary')),
    CHECK (used_percent >= 0 AND used_percent <= 100),
    CHECK (duration_minutes IS NULL OR duration_minutes > 0)
);
