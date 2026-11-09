-- PAGE-284: the live progress of a plan step. update_step_progress reports
-- the state of the step's todos and a short activity while the turn runs;
-- the row is kept per run and node, so a further attempt of the same run
-- starts from the last reported state. report_step_result stays the binding
-- result of the step.
CREATE TABLE agent_plan_step_progress (
    run_id TEXT NOT NULL,
    step_id TEXT NOT NULL,
    attempt_id TEXT NOT NULL,
    todos_json TEXT NOT NULL,
    activity TEXT,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (run_id, step_id)
);

-- The cost an adapter reports with usage_update, where it reports one.
ALTER TABLE agent_session_attempts
    ADD COLUMN cost_amount DOUBLE PRECISION;

ALTER TABLE agent_session_attempts
    ADD COLUMN cost_currency TEXT;
