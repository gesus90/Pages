CREATE SEQUENCE agent_plan_start_rejection_order START 1;

CREATE TABLE agent_plan_start_rejections (
    id TEXT PRIMARY KEY,
    sequence_number BIGINT NOT NULL DEFAULT nextval('agent_plan_start_rejection_order'),
    plan_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    rejection_json TEXT NOT NULL
);

CREATE INDEX agent_plan_start_rejections_owner
    ON agent_plan_start_rejections (plan_id, user_id, sequence_number);
