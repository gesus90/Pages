-- PAGE-307: diagnosis of agent plan runs for the whole team.
--
-- agent_run_failures holds one row per failed step of a run with its fixed
-- error class; agent_run_failure_index remembers the write revision of the run
-- the rows were derived from, so a run is classified again only after it
-- changed. Both outlive the purge of earlier runs of a plan (PAGE-255): the
-- failure series stay countable for the retention time of the diagnosis.
-- agent_run_logs holds the server, runner and CLI log lines that carry a run,
-- step and attempt. agent_run_diagnosis_settings is the one instance setting
-- row under Settings → Agents.
CREATE TABLE agent_run_failures (
    run_id TEXT NOT NULL,
    failure_key TEXT NOT NULL,
    plan_id TEXT NOT NULL,
    plan_name TEXT NOT NULL,
    project_id TEXT NOT NULL,
    started_by_id TEXT NOT NULL,
    step_id TEXT NOT NULL,
    step_label TEXT NOT NULL,
    loop_id TEXT,
    iteration INTEGER,
    attempt_id TEXT,
    error_class TEXT NOT NULL,
    error_code TEXT NOT NULL,
    occurred_at TEXT NOT NULL,
    PRIMARY KEY (run_id, failure_key),
    CHECK (error_class IN (
        'model', 'tool_missing', 'timeout', 'git', 'workspace_busy',
        'permission', 'plan_invalid', 'process_crash', 'runner_unavailable',
        'acceptance_failed', 'unknown'
    ))
);

CREATE INDEX agent_run_failures_occurred ON agent_run_failures (occurred_at);
CREATE INDEX agent_run_failures_plan ON agent_run_failures (plan_id, occurred_at);
CREATE INDEX agent_run_failures_project ON agent_run_failures (project_id, occurred_at);

CREATE TABLE agent_run_failure_index (
    run_id TEXT NOT NULL,
    indexed_revision BIGINT NOT NULL,
    plan_id TEXT NOT NULL,
    plan_name TEXT NOT NULL,
    ended_at TEXT,
    failed_step_id TEXT,
    error_class TEXT,
    error_code TEXT,
    PRIMARY KEY (run_id),
    CHECK (
        error_class IS NULL OR error_class IN (
            'model', 'tool_missing', 'timeout', 'git', 'workspace_busy',
            'permission', 'plan_invalid', 'process_crash', 'runner_unavailable',
            'acceptance_failed', 'unknown'
        )
    )
);

CREATE TABLE agent_run_logs (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    run_id TEXT NOT NULL,
    step_id TEXT,
    attempt_id TEXT,
    logged_at TEXT NOT NULL,
    level TEXT NOT NULL,
    source TEXT NOT NULL,
    message TEXT NOT NULL,
    is_filtered BOOLEAN NOT NULL DEFAULT FALSE,
    CHECK (level IN ('debug', 'info', 'warn', 'error')),
    CHECK (source IN ('server', 'runner', 'cli'))
);

CREATE INDEX agent_run_logs_run ON agent_run_logs (run_id, id);
CREATE INDEX agent_run_logs_step ON agent_run_logs (run_id, step_id, id);
CREATE INDEX agent_run_logs_logged ON agent_run_logs (logged_at);

CREATE TABLE agent_run_diagnosis_settings (
    id INTEGER NOT NULL,
    log_retention_days INTEGER NOT NULL DEFAULT 30,
    stall_minutes INTEGER NOT NULL DEFAULT 15,
    revision INTEGER NOT NULL DEFAULT 1,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    CHECK (id = 1),
    CHECK (log_retention_days BETWEEN 1 AND 365),
    CHECK (stall_minutes BETWEEN 1 AND 1440)
);

INSERT INTO agent_run_diagnosis_settings (id) VALUES (1);

-- Lists of runs across plans read by start time and by starter.
CREATE INDEX agent_plan_runs_started ON agent_plan_runs (started_at);
CREATE INDEX agent_plan_runs_user ON agent_plan_runs (user_id, started_at);
