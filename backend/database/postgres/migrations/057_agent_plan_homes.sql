-- PAGE-352: Stable transcript homes follow the plan instead of individual runs.
CREATE FUNCTION queue_agent_plan_home_garbage() RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO agent_payload_garbage (storage_name)
    VALUES ('plan-homes/' || OLD.id || '/')
    ON CONFLICT DO NOTHING;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER agent_plan_home_garbage
AFTER DELETE ON agent_plans
FOR EACH ROW EXECUTE FUNCTION queue_agent_plan_home_garbage();
