CREATE SEQUENCE agent_plan_cleanup_failure_order START 1;

CREATE TABLE agent_plan_cleanup_failures (
    id TEXT PRIMARY KEY,
    sequence_number BIGINT NOT NULL DEFAULT nextval('agent_plan_cleanup_failure_order'),
    run_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    failure_json TEXT NOT NULL
);

CREATE INDEX agent_plan_cleanup_failures_owner
    ON agent_plan_cleanup_failures (run_id, user_id, sequence_number);
