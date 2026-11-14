ALTER TABLE agent_workspace_cleanup
    ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN next_attempt_at BIGINT NOT NULL DEFAULT 0,
    ADD COLUMN retry_started_at TEXT,
    ADD COLUMN event_revision BIGINT NOT NULL DEFAULT 0,
    ADD COLUMN stop_revision BIGINT NOT NULL DEFAULT -1;

UPDATE agent_workspace_cleanup SET retry_started_at = requested_at;

CREATE INDEX agent_workspace_cleanup_due
    ON agent_workspace_cleanup (next_attempt_at)
    WHERE state = 'pending';

CREATE FUNCTION wake_workspace_cleanup() RETURNS TRIGGER AS $$
BEGIN
    UPDATE agent_workspace_cleanup
    SET attempts = 0,
        next_attempt_at = 0,
        retry_started_at = utc_now(),
        event_revision = event_revision + 1,
        state = 'pending',
        updated_at = CASE WHEN state <> 'pending' THEN utc_now() ELSE updated_at END
    WHERE run_id = NEW.id AND state <> 'completed';
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER agent_run_cleanup_event
    AFTER UPDATE OF view_json ON agent_plan_runs
    FOR EACH ROW WHEN (OLD.view_json IS DISTINCT FROM NEW.view_json)
    EXECUTE FUNCTION wake_workspace_cleanup();

