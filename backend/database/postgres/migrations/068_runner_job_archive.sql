ALTER TABLE agent_session_attempts
    ALTER COLUMN next_sequence TYPE BIGINT;

ALTER TABLE agent_session_events
    ALTER COLUMN sequence TYPE BIGINT;

CREATE TABLE runner_job_archive (
    job_id TEXT PRIMARY KEY,
    connection_id TEXT NOT NULL REFERENCES pages_runners(connection_id) ON DELETE CASCADE,
    run_id TEXT NOT NULL REFERENCES agent_plan_runs(id) ON DELETE CASCADE,
    attempt_id TEXT NOT NULL,
    job_json JSONB NOT NULL,
    completed_at TEXT NOT NULL
);

CREATE INDEX runner_job_archive_attempt_idx
    ON runner_job_archive (connection_id, run_id, attempt_id);
