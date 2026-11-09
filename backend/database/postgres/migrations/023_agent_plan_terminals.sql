-- PAGE-265: the terminal of a plan node. One row per CLI process
-- (instance_id); members of a group share it. Segments hold the redacted
-- output in order; inputs wait only until the process of the terminal applied
-- them. Terminal logs of a completed run are deleted at once, those of a
-- failed or stopped run with the run when the plan starts its next run.
CREATE TABLE agent_plan_terminals (
    instance_id TEXT NOT NULL,
    run_id TEXT NOT NULL,
    step_id TEXT NOT NULL,
    provider TEXT NOT NULL,
    state TEXT NOT NULL,
    columns_count INTEGER NOT NULL,
    rows_count INTEGER NOT NULL,
    is_alternate_screen BOOLEAN NOT NULL DEFAULT FALSE,
    screen TEXT,
    screen_sequence BIGINT NOT NULL DEFAULT 0,
    next_sequence BIGINT NOT NULL DEFAULT 1,
    retained_from BIGINT NOT NULL DEFAULT 1,
    stored_characters BIGINT NOT NULL DEFAULT 0,
    active_step_id TEXT,
    question TEXT,
    started_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    ended_at TEXT,
    PRIMARY KEY (instance_id),
    CHECK (provider IN ('codex_cli', 'claude_code', 'opencode')),
    CHECK (state IN ('running', 'ended'))
);

CREATE INDEX agent_plan_terminals_run ON agent_plan_terminals (run_id);

CREATE TABLE agent_plan_terminal_segments (
    instance_id TEXT NOT NULL,
    "sequence" BIGINT NOT NULL,
    body TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (instance_id, "sequence")
);

CREATE TABLE agent_plan_terminal_inputs (
    id BIGSERIAL NOT NULL,
    instance_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    body TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (id),
    CHECK (kind IN ('data', 'paste', 'interrupt', 'resize'))
);

CREATE INDEX agent_plan_terminal_inputs_instance
    ON agent_plan_terminal_inputs (instance_id, id);

-- A run with manual input stays marked after its terminal logs are gone.
ALTER TABLE agent_plan_runs
    ADD COLUMN manual_input_at TEXT;
