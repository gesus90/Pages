-- PAGE-208: the result an agent reports through report_step_result. A row is the
-- open report slot of one session credential: the attempt that may report now and
-- what its report is checked against. It lives from the start of a turn to its
-- assessment; it is separate from the run view, which the engine rewrites.
CREATE TABLE agent_plan_step_reports (
    run_id TEXT NOT NULL,
    session_scope_id TEXT NOT NULL,
    step_id TEXT NOT NULL,
    attempt_id TEXT NOT NULL,
    terms_json TEXT NOT NULL,
    report_json TEXT,
    PRIMARY KEY (run_id, session_scope_id)
);
