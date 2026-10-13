ALTER TABLE agent_execution_profiles ADD COLUMN owner_id TEXT;
ALTER TABLE agent_execution_profiles ADD COLUMN model_profile_id TEXT;

CREATE TABLE page_agent_run_records (
    agent_id TEXT NOT NULL,
    run_id TEXT NOT NULL,
    record_json TEXT NOT NULL,
    PRIMARY KEY (agent_id, run_id)
);

CREATE TABLE page_agent_run_inputs (
    plan_run_id TEXT NOT NULL,
    step_id TEXT NOT NULL,
    prompt TEXT NOT NULL,
    PRIMARY KEY (plan_run_id, step_id)
);
