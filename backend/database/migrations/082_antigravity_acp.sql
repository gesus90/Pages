-- Antigravity uses the existing connection, lease and session aggregates.
-- DuckDB requires rebuilding CHECK constraints; preserve all rows and account types.
CREATE TABLE agent_connections_antigravity (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    provider TEXT NOT NULL CHECK (provider IN (
        'openrouter', 'openai', 'google_ai_studio', 'zai', 'anthropic',
        'codex_cli', 'claude_code', 'opencode', 'antigravity'
    )),
    secret_encrypted TEXT,
    test_model TEXT,
    cli_logged_in_at TEXT,
    cli_account_label TEXT,
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT utc_now(),
    updated_by TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT utc_now(),
    reasoning_effort TEXT,
    is_active BOOLEAN DEFAULT TRUE,
    zai_account_type TEXT DEFAULT 'api',
    CHECK (
        (provider IN ('codex_cli', 'claude_code', 'opencode', 'antigravity') AND secret_encrypted IS NULL)
        OR (provider NOT IN ('codex_cli', 'claude_code', 'opencode', 'antigravity')
            AND secret_encrypted IS NOT NULL
            AND cli_logged_in_at IS NULL
            AND cli_account_label IS NULL)
    )
);

INSERT INTO agent_connections_antigravity (
    id,
    name,
    provider,
    secret_encrypted,
    test_model,
    cli_logged_in_at,
    cli_account_label,
    created_by,
    created_at,
    updated_by,
    updated_at,
    reasoning_effort,
    is_active,
    zai_account_type
)
SELECT
    id,
    name,
    provider,
    secret_encrypted,
    test_model,
    cli_logged_in_at,
    cli_account_label,
    created_by,
    created_at,
    updated_by,
    updated_at,
    reasoning_effort,
    is_active,
    zai_account_type
FROM agent_connections;

DROP TABLE agent_connections;
ALTER TABLE agent_connections_antigravity RENAME TO agent_connections;
CREATE UNIQUE INDEX agent_connections_name_lower ON agent_connections (lower(name));

CREATE TABLE acp_resource_leases_antigravity (
    instance_id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    provider TEXT NOT NULL CHECK (provider IN ('codex_cli', 'claude_code', 'opencode', 'antigravity')),
    run_id TEXT,
    step_id TEXT,
    state TEXT NOT NULL CHECK (
        state IN ('starting', 'running', 'idle', 'closing', 'cleanup_failed')
    ),
    since TEXT NOT NULL
);

INSERT INTO acp_resource_leases_antigravity (
    instance_id,
    user_id,
    provider,
    run_id,
    step_id,
    state,
    since
)
SELECT
    instance_id,
    user_id,
    provider,
    run_id,
    step_id,
    state,
    since
FROM acp_resource_leases;

DROP TABLE acp_resource_leases;
ALTER TABLE acp_resource_leases_antigravity RENAME TO acp_resource_leases;


CREATE TABLE agent_session_attempts_antigravity (
    attempt_id TEXT PRIMARY KEY,
    plan_id TEXT NOT NULL,
    run_id TEXT NOT NULL,
    step_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    provider TEXT NOT NULL CHECK (provider IN ('codex_cli', 'claude_code', 'opencode', 'antigravity')),
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

INSERT INTO agent_session_attempts_antigravity (
    attempt_id,
    plan_id,
    run_id,
    step_id,
    user_id,
    provider,
    instance_id,
    group_id,
    state,
    next_sequence,
    context_used,
    context_limit,
    context_source,
    context_at,
    confirmed_model,
    confirmed_model_source,
    confirmed_model_at,
    confirmed_reasoning,
    confirmed_reasoning_source,
    confirmed_reasoning_at,
    workspace_directory,
    git_state,
    git_reference,
    workspace_at,
    updated_at
)
SELECT
    attempt_id,
    plan_id,
    run_id,
    step_id,
    user_id,
    provider,
    instance_id,
    group_id,
    state,
    next_sequence,
    context_used,
    context_limit,
    context_source,
    context_at,
    confirmed_model,
    confirmed_model_source,
    confirmed_model_at,
    confirmed_reasoning,
    confirmed_reasoning_source,
    confirmed_reasoning_at,
    workspace_directory,
    git_state,
    git_reference,
    workspace_at,
    updated_at
FROM agent_session_attempts;

DROP TABLE agent_session_attempts;
ALTER TABLE agent_session_attempts_antigravity RENAME TO agent_session_attempts;
CREATE INDEX agent_session_attempt_run ON agent_session_attempts (run_id, step_id);
