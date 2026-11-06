ALTER TABLE agent_plan_runs ADD COLUMN snapshot_file TEXT;
ALTER TABLE agent_plan_continuations ADD COLUMN snapshot_file TEXT;
ALTER TABLE agent_session_events ADD COLUMN body_file TEXT;
ALTER TABLE agent_session_history_chunks ADD COLUMN events_file TEXT;
ALTER TABLE runner_history_recovery ADD COLUMN packet_file TEXT;
ALTER TABLE runner_history_recovery ADD COLUMN payload_plan_id TEXT;
ALTER TABLE runner_history_recovery ADD COLUMN payload_run_id TEXT;

CREATE TABLE agent_payload_garbage (
    storage_name TEXT PRIMARY KEY
);

-- A deletion intent commits with the disappearing reference; file removal follows the commit.
CREATE FUNCTION queue_agent_payload_garbage() RETURNS TRIGGER AS $$
DECLARE
    reference_text TEXT;
BEGIN
    reference_text := to_jsonb(OLD) ->> TG_ARGV[0];
    IF reference_text IS NOT NULL AND (
        TG_OP = 'DELETE' OR reference_text IS DISTINCT FROM (to_jsonb(NEW) ->> TG_ARGV[0])
    ) THEN
        INSERT INTO agent_payload_garbage (storage_name)
        VALUES (reference_text::jsonb ->> 'path')
        ON CONFLICT DO NOTHING;
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER agent_plan_run_payload_garbage
AFTER DELETE OR UPDATE OF snapshot_file ON agent_plan_runs
FOR EACH ROW EXECUTE FUNCTION queue_agent_payload_garbage('snapshot_file');

CREATE TRIGGER agent_plan_continuation_payload_garbage
AFTER DELETE OR UPDATE OF snapshot_file ON agent_plan_continuations
FOR EACH ROW EXECUTE FUNCTION queue_agent_payload_garbage('snapshot_file');

CREATE TRIGGER agent_session_event_payload_garbage
AFTER DELETE OR UPDATE OF body_file ON agent_session_events
FOR EACH ROW EXECUTE FUNCTION queue_agent_payload_garbage('body_file');

CREATE TRIGGER agent_session_chunk_payload_garbage
AFTER DELETE OR UPDATE OF events_file ON agent_session_history_chunks
FOR EACH ROW EXECUTE FUNCTION queue_agent_payload_garbage('events_file');

CREATE TRIGGER runner_history_payload_garbage
AFTER DELETE OR UPDATE OF packet_file ON runner_history_recovery
FOR EACH ROW EXECUTE FUNCTION queue_agent_payload_garbage('packet_file');

CREATE FUNCTION queue_agent_plan_payload_garbage() RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO agent_payload_garbage (storage_name)
    VALUES ('agent-payloads/' || encode(sha256(convert_to(OLD.id, 'UTF8')), 'hex') || '/')
    ON CONFLICT DO NOTHING;
    DELETE FROM runner_history_recovery WHERE payload_plan_id = OLD.id;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER agent_plan_payload_garbage
AFTER DELETE ON agent_plans
FOR EACH ROW EXECUTE FUNCTION queue_agent_plan_payload_garbage();

CREATE FUNCTION delete_agent_run_history_payloads() RETURNS TRIGGER AS $$
BEGIN
    DELETE FROM runner_history_recovery WHERE payload_run_id = OLD.id;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER agent_run_history_payloads
AFTER DELETE ON agent_plan_runs
FOR EACH ROW EXECUTE FUNCTION delete_agent_run_history_payloads();
