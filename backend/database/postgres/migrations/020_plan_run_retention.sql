-- PAGE-255: A plan keeps only the data of its latest run. The start of a genuinely
-- new run records a purge intent in agent_payload_garbage with the same commit;
-- the background collector then deletes the earlier runs of that plan. These
-- triggers queue the files outside the database that belong to a disappearing
-- run, so they follow the rows that referenced them, also after a crash.

-- The transcript homes of a run, below every connection: agents/*/plan-sessions/<run>.
CREATE FUNCTION queue_agent_plan_session_garbage() RETURNS TRIGGER AS $$
BEGIN
    IF OLD.id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
        INSERT INTO agent_payload_garbage (storage_name)
        VALUES ('plan-sessions/' || OLD.id || '/')
        ON CONFLICT DO NOTHING;
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER agent_plan_session_garbage
AFTER DELETE ON agent_plan_runs
FOR EACH ROW EXECUTE FUNCTION queue_agent_plan_session_garbage();

-- The journal of a local session owner and the payload files it names.
CREATE FUNCTION queue_agent_local_session_garbage() RETURNS TRIGGER AS $$
BEGIN
    IF OLD.instance_id ~ '^[0-9a-f-]{36}$' THEN
        INSERT INTO agent_payload_garbage (storage_name)
        VALUES ('local-sessions/' || OLD.instance_id || '/')
        ON CONFLICT DO NOTHING;
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER agent_local_session_garbage
AFTER DELETE ON agent_local_session_owners
FOR EACH ROW EXECUTE FUNCTION queue_agent_local_session_garbage();

CREATE TRIGGER agent_local_result_payload_garbage
AFTER DELETE OR UPDATE OF payload_file ON agent_local_session_results
FOR EACH ROW EXECUTE FUNCTION queue_agent_payload_garbage('payload_file');

CREATE INDEX agent_plan_runs_plan_order
    ON agent_plan_runs (plan_id, creation_order);
