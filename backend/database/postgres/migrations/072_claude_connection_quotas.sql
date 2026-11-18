-- What Claude Code last reported about the claude.ai subscription of a Claude
-- connection. claude_connection_quota_windows holds one row per window Claude
-- reported: five_hour or seven_day with the used share (0 to 100) and the
-- reset. A window Claude never reported has no row; it is never stored as 0.
-- claude_connection_plans holds the subscription the adapter reported: pro,
-- max, ultra, or NULL for a sign-in without a known plan. observed_at is the
-- time of the reading, so a late write of an older reading never replaces a
-- newer one. Times are ISO 8601 in UTC.
CREATE TABLE claude_connection_quota_windows (
    connection_id TEXT NOT NULL,
    window_kind TEXT NOT NULL,
    used_percentage DOUBLE PRECISION NOT NULL,
    resets_at TEXT NOT NULL,
    observed_at TEXT NOT NULL,
    PRIMARY KEY (connection_id, window_kind),
    CHECK (window_kind IN ('five_hour', 'seven_day')),
    CHECK (used_percentage >= 0 AND used_percentage <= 100)
);

CREATE TABLE claude_connection_plans (
    connection_id TEXT NOT NULL,
    plan TEXT,
    observed_at TEXT NOT NULL,
    PRIMARY KEY (connection_id),
    CHECK (plan IN ('pro', 'max', 'ultra'))
);
