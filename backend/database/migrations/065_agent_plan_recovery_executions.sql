-- PAGE-127: explicit restarts, resumes and releases of a disturbed run. Each row
-- names the earlier run it came from and the run it started; the earlier run and
-- its repair journal stay unchanged.
CREATE TABLE agent_plan_recovery_executions (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    action TEXT NOT NULL CHECK (action IN ('restart', 'resume', 'release')),
    idempotency_key TEXT NOT NULL,
    request_digest TEXT NOT NULL,
    expected_revision BIGINT NOT NULL,
    result_revision BIGINT NOT NULL,
    target_run_id TEXT,
    execution_json TEXT NOT NULL,
    result_json TEXT NOT NULL,
    UNIQUE (run_id, idempotency_key)
);

CREATE INDEX agent_plan_recovery_execution_run ON agent_plan_recovery_executions (run_id, result_revision);
