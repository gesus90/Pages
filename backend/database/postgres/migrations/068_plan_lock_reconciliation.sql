ALTER TABLE agent_plan_workspace_locks
    ADD COLUMN acquired_at TEXT NOT NULL DEFAULT utc_now();

UPDATE agent_plan_workspace_locks AS locks
SET acquired_at = runs.started_at
FROM agent_plan_runs AS runs
WHERE runs.id = locks.run_id;

ALTER TABLE agent_payload_garbage
    ADD COLUMN retry_count INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN retry_after BIGINT NOT NULL DEFAULT 0,
    ADD COLUMN last_deferred_log_at BIGINT NOT NULL DEFAULT 0;
