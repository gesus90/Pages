CREATE TABLE plan_run_commands (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES agent_plan_runs(id) ON DELETE CASCADE,
    action TEXT NOT NULL CHECK (action IN ('start', 'pause', 'stop', 'resume')),
    status TEXT NOT NULL DEFAULT 'accepted' CHECK (status IN ('accepted', 'applied', 'failed')),
    accepted_at TEXT NOT NULL,
    completed_at TEXT,
    delivery_complete BOOLEAN NOT NULL DEFAULT FALSE,
    error TEXT,
    snapshot_file TEXT,
    creation_order BIGINT GENERATED ALWAYS AS IDENTITY UNIQUE
);

CREATE INDEX plan_run_commands_pending
    ON plan_run_commands (creation_order)
    WHERE NOT delivery_complete;
CREATE INDEX plan_run_commands_run
    ON plan_run_commands (run_id, creation_order DESC);

CREATE TRIGGER plan_run_command_payload_garbage
AFTER DELETE OR UPDATE OF snapshot_file ON plan_run_commands
FOR EACH ROW EXECUTE FUNCTION queue_agent_payload_garbage('snapshot_file');

CREATE TABLE plan_run_api_cleanup (
    attempt_id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES agent_plan_runs(id) ON DELETE CASCADE,
    step_id TEXT NOT NULL
);
