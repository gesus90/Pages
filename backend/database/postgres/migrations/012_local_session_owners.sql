CREATE TABLE agent_local_session_owners (
    instance_id TEXT PRIMARY KEY,
    instance_key TEXT NOT NULL,
    run_id TEXT NOT NULL REFERENCES agent_plan_runs(id) ON DELETE CASCADE,
    step_id TEXT NOT NULL,
    attempt_id TEXT NOT NULL,
    manifest_digest TEXT NOT NULL,
    proof TEXT,
    importer_token TEXT,
    acknowledged_sequence BIGINT NOT NULL DEFAULT 0,
    acknowledged_digest TEXT NOT NULL DEFAULT '',
    checkpoint_file TEXT,
    released_at TEXT,
    created_at TEXT NOT NULL
);

ALTER TABLE agent_plan_runs ADD COLUMN engine_file TEXT;
ALTER TABLE agent_plan_step_reports ADD COLUMN closed_at TEXT;

CREATE TRIGGER agent_plan_engine_payload_garbage
AFTER DELETE OR UPDATE OF engine_file ON agent_plan_runs
FOR EACH ROW EXECUTE FUNCTION queue_agent_payload_garbage('engine_file');

CREATE TRIGGER agent_local_checkpoint_payload_garbage
AFTER DELETE OR UPDATE OF checkpoint_file ON agent_local_session_owners
FOR EACH ROW EXECUTE FUNCTION queue_agent_payload_garbage('checkpoint_file');

CREATE INDEX agent_local_session_owners_run
    ON agent_local_session_owners (run_id);

CREATE TABLE agent_local_session_results (
    instance_id TEXT NOT NULL REFERENCES agent_local_session_owners(instance_id) ON DELETE CASCADE,
    turn_id TEXT NOT NULL,
    payload_file TEXT NOT NULL,
    PRIMARY KEY (instance_id, turn_id)
);
