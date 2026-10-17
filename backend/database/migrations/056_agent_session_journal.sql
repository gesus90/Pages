-- PageAgentCLI (PAGE-85): the structured history, usage and instructions of plan node sessions.
-- Runs from before this migration keep their records unchanged; their attempts have no rows
-- here and read as a legacy history whose missing values are unknown, never zero.

-- One row per node attempt. Members of an ACP group share the process instance, never a row.
CREATE TABLE agent_session_attempts (
    attempt_id TEXT PRIMARY KEY,
    plan_id TEXT NOT NULL,
    run_id TEXT NOT NULL,
    step_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    provider TEXT NOT NULL CHECK (provider IN ('codex_cli', 'claude_code', 'opencode')),
    instance_id TEXT NOT NULL,
    group_id TEXT,
    state TEXT NOT NULL CHECK (
        state IN (
            'starting',
            'running',
            'waiting_for_input',
            'idle',
            'waiting_for_capacity',
            'recovering',
            'ended',
            'failed',
            'cancelled'
        )
    ),
    -- The next sequence of the attempt's events; it only grows, also when retention removes events.
    next_sequence INTEGER NOT NULL DEFAULT 1,
    -- Latest context occupancy as the adapter reported it; NULL means not reported.
    context_used BIGINT,
    context_limit BIGINT,
    context_source TEXT,
    context_at TEXT,
    -- The model and effort the adapter confirmed, with their origin; NULL means not confirmed.
    confirmed_model TEXT,
    confirmed_model_source TEXT,
    confirmed_model_at TEXT,
    confirmed_reasoning TEXT,
    confirmed_reasoning_source TEXT,
    confirmed_reasoning_at TEXT,
    -- The checked workspace and its Git state, read from the repository files by Pages.
    workspace_directory TEXT,
    git_state TEXT CHECK (git_state IN ('branch', 'detached', 'no_repository', 'unreadable')),
    git_reference TEXT,
    workspace_at TEXT,
    updated_at TEXT NOT NULL
);

CREATE INDEX agent_session_attempt_run ON agent_session_attempts (run_id, step_id);

-- Redacted events in sequence order; the dedupe key drops a second report of the same fact.
CREATE TABLE agent_session_events (
    attempt_id TEXT NOT NULL,
    sequence INTEGER NOT NULL,
    turn INTEGER,
    kind TEXT NOT NULL,
    body TEXT NOT NULL,
    is_truncated BOOLEAN NOT NULL DEFAULT FALSE,
    dedupe_key TEXT,
    created_at TEXT NOT NULL,
    PRIMARY KEY (attempt_id, sequence)
);

-- Tokens per turn, written once per turn so a repeated report is not counted twice.
CREATE TABLE agent_session_turn_usage (
    attempt_id TEXT NOT NULL,
    turn INTEGER NOT NULL,
    provider TEXT NOT NULL,
    model TEXT,
    input_tokens BIGINT,
    output_tokens BIGINT,
    cache_read_tokens BIGINT,
    cache_write_tokens BIGINT,
    total_tokens BIGINT,
    input_includes_cache BOOLEAN,
    is_partial BOOLEAN NOT NULL DEFAULT FALSE,
    reported_at TEXT NOT NULL,
    PRIMARY KEY (attempt_id, turn)
);

-- Additional and repair instructions, apart from the frozen plan assignment.
CREATE TABLE agent_session_messages (
    id TEXT PRIMARY KEY,
    attempt_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('instruction', 'repair')),
    body TEXT NOT NULL,
    status TEXT NOT NULL CHECK (
        status IN ('queued', 'delivering', 'delivered', 'failed', 'cancelled', 'uncertain')
    ),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX agent_session_message_attempt ON agent_session_messages (attempt_id);
