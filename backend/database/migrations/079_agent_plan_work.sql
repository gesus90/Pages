CREATE TABLE agent_plan_work (
    run_id TEXT NOT NULL,
    step_id TEXT NOT NULL,
    attempt_id TEXT NOT NULL,
    ticket_id TEXT NOT NULL,
    revision INTEGER NOT NULL,
    record_json TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT utc_now(),
    PRIMARY KEY (run_id, step_id, attempt_id, ticket_id, revision)
);
