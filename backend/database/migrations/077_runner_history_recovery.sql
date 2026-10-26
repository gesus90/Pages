CREATE TABLE runner_history_recovery (
    event_id TEXT PRIMARY KEY,
    connection_id TEXT NOT NULL,
    job_id TEXT NOT NULL,
    sequence BIGINT NOT NULL,
    packet_json TEXT NOT NULL,
    received_at TEXT NOT NULL DEFAULT utc_now(),
    restored_at TEXT,
    last_attempt_at TEXT,
    diagnosis_json TEXT
);

CREATE INDEX runner_history_recovery_pending
ON runner_history_recovery (connection_id, restored_at, sequence);
