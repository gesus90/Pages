-- What Antigravity last reported about the quota of an Antigravity connection.
-- antigravity_connection_quotas holds one row per connection that was queried
-- successfully: observed_at is the time of that answer, also when the answer
-- held no quota data. antigravity_connection_quota_windows holds one row per
-- window of each reported group: group_position is the position of the group
-- in the source, window_kind is five_hour or seven_day, and remaining_fraction
-- is the rest exactly as reported, 0 to 1, never derived from a used share. A
-- window Antigravity did not report has no row; it is never stored as 0.
-- resets_at is NULL when Antigravity named no reset. Times are ISO 8601 in UTC.
-- Both tables follow the connection when it is removed.
CREATE TABLE antigravity_connection_quotas (
    connection_id TEXT NOT NULL REFERENCES agent_connections (id) ON DELETE CASCADE,
    observed_at TEXT NOT NULL,
    PRIMARY KEY (connection_id)
);

CREATE TABLE antigravity_connection_quota_windows (
    connection_id TEXT NOT NULL REFERENCES antigravity_connection_quotas (connection_id) ON DELETE CASCADE,
    group_position INTEGER NOT NULL,
    group_name TEXT NOT NULL,
    window_kind TEXT NOT NULL,
    remaining_fraction DOUBLE PRECISION NOT NULL,
    resets_at TEXT,
    PRIMARY KEY (connection_id, group_position, window_kind),
    CHECK (group_position >= 0),
    CHECK (window_kind IN ('five_hour', 'seven_day')),
    CHECK (remaining_fraction >= 0 AND remaining_fraction <= 1)
);
