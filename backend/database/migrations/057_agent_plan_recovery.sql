-- PAGE-84: additive recovery metadata preserves every older run and snapshot.
ALTER TABLE agent_plan_runs ADD COLUMN recovery_revision BIGINT DEFAULT 0;
ALTER TABLE agent_plan_runs ALTER COLUMN recovery_revision SET NOT NULL;

-- Completion and checkpoint are written together. A successful node has one immutable completion.
CREATE TABLE agent_plan_checkpoints (
    run_id TEXT NOT NULL,
    version INTEGER NOT NULL,
    step_id TEXT NOT NULL,
    run_revision BIGINT NOT NULL,
    checkpoint_json TEXT NOT NULL,
    PRIMARY KEY (run_id, version),
    UNIQUE (run_id, step_id)
);

-- These are recorded preparations and decisions, not automatically dispatched agent executions.
CREATE TABLE agent_plan_repair_attempts (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    step_id TEXT,
    action TEXT NOT NULL CHECK (action IN ('record_repair', 'reconcile', 'cancel')),
    idempotency_key TEXT NOT NULL,
    request_digest TEXT NOT NULL,
    expected_revision BIGINT NOT NULL,
    result_revision BIGINT NOT NULL,
    attempt_json TEXT NOT NULL,
    result_json TEXT NOT NULL,
    UNIQUE (run_id, idempotency_key)
);

CREATE INDEX agent_plan_repair_run ON agent_plan_repair_attempts (run_id, result_revision);
