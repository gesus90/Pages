-- DuckDB cannot alter an existing CHECK constraint; keep every occupied lease.
CREATE TABLE acp_resource_leases_opencode (
    instance_id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    provider TEXT NOT NULL CHECK (provider IN ('codex_cli', 'claude_code', 'opencode')),
    run_id TEXT,
    step_id TEXT,
    state TEXT NOT NULL CHECK (
        state IN ('starting', 'running', 'idle', 'closing', 'cleanup_failed')
    ),
    since TEXT NOT NULL
);

INSERT INTO acp_resource_leases_opencode (
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
ALTER TABLE acp_resource_leases_opencode RENAME TO acp_resource_leases;

-- The native adapter reports session costs and only the last model step's tokens.
ALTER TABLE chat_jobs ADD COLUMN cost_scope TEXT;
ALTER TABLE chat_job_turns ADD COLUMN tokens_are_partial BOOLEAN DEFAULT FALSE;
