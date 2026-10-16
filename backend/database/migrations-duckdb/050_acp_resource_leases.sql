-- Written before spawn; retained until the process tree is confirmed gone.
CREATE TABLE acp_resource_leases (
    instance_id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    provider TEXT NOT NULL CHECK (provider IN ('codex_cli', 'claude_code')),
    run_id TEXT,
    step_id TEXT,
    state TEXT NOT NULL CHECK (
        state IN ('starting', 'running', 'idle', 'closing', 'cleanup_failed')
    ),
    since TEXT NOT NULL
);
