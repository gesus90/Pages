-- Pica Mobile notifications (PAGE-193).
--
-- Timestamps are ISO-8601 UTC text written by the application, so text
-- comparison orders them. The tables are small and pruned, so they carry no
-- secondary index and no foreign key (see 001_baseline.sql and
-- 085_rebuild_buffered_secondary_indexes.sql).

CREATE TABLE pica_mobile_notification_instance (
    singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
    instance_id TEXT NOT NULL
);

-- One row per registered device. The FCM token is stored encrypted; the
-- fingerprint only finds a token that moved to another device or account.
CREATE TABLE pica_mobile_push_registrations (
    device_id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL,
    session_id TEXT NOT NULL,
    token_fingerprint TEXT NOT NULL,
    token_encrypted TEXT NOT NULL,
    locale TEXT NOT NULL CHECK (locale IN ('de', 'en')),
    preview TEXT NOT NULL CHECK (preview IN ('hidden', 'details')),
    registered_at TEXT NOT NULL,
    renewed_at TEXT NOT NULL,
    activated_at TEXT
);

-- The business events of runs. Names of plans and steps are not stored: a
-- read looks them up again with the current rights of the account.
CREATE TABLE pica_mobile_notification_events (
    event_id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL,
    plan_id TEXT NOT NULL,
    run_id TEXT NOT NULL,
    seq BIGINT NOT NULL,
    event_type TEXT NOT NULL CHECK (
        event_type IN (
            'step_started',
            'run_cancelled',
            'run_failed',
            'run_succeeded'
        )
    ),
    occurred_at TEXT NOT NULL,
    steps_json TEXT,
    step_count INTEGER,
    reason TEXT
);

-- Last sequence number handed out per run. It is kept as long as the run
-- exists, so a resumed run or a restarted server never reuses a number.
CREATE TABLE pica_mobile_notification_sequences (
    run_id TEXT PRIMARY KEY,
    last_seq BIGINT NOT NULL
);

-- Every step instance and every end of a run is announced once, however often
-- a callback repeats.
CREATE TABLE pica_mobile_notification_occurrences (
    run_id TEXT NOT NULL,
    occurrence_key TEXT NOT NULL,
    event_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (run_id, occurrence_key)
);

-- Outbox of push attempts, one row per event and device.
CREATE TABLE pica_mobile_notification_deliveries (
    delivery_id TEXT PRIMARY KEY,
    event_id TEXT NOT NULL,
    device_id TEXT NOT NULL,
    account_id TEXT NOT NULL,
    run_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    seq BIGINT NOT NULL,
    state TEXT NOT NULL CHECK (
        state IN (
            'pending',
            'sending',
            'sent',
            'failed',
            'expired',
            'superseded',
            'dropped'
        )
    ),
    attempts INTEGER NOT NULL,
    not_before TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    locked_until TEXT,
    outcome TEXT,
    created_at TEXT NOT NULL,
    finished_at TEXT
);
