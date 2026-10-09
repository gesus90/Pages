-- Agent connections (A7): named, instance-wide AI accesses managed by administrators.
-- API keys are encrypted; CLI credentials live in a private directory beside the DB.
CREATE TABLE agent_connections (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    provider TEXT NOT NULL CHECK (provider IN (
        'openrouter', 'openai', 'google_ai_studio', 'zai', 'anthropic',
        'codex_cli', 'claude_code'
    )),
    secret_encrypted TEXT,
    test_model TEXT,
    cli_logged_in_at TEXT,
    cli_account_label TEXT,
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT utc_now(),
    updated_by TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT utc_now(),
    CHECK (
        (provider IN ('codex_cli', 'claude_code') AND secret_encrypted IS NULL)
        OR (provider NOT IN ('codex_cli', 'claude_code')
            AND secret_encrypted IS NOT NULL
            AND cli_logged_in_at IS NULL
            AND cli_account_label IS NULL)
    )
);

CREATE UNIQUE INDEX agent_connections_name_lower ON agent_connections (lower(name));

CREATE TABLE agent_connection_checks (
    connection_id TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('auth', 'model')),
    status TEXT NOT NULL CHECK (status IN ('passed', 'failed')),
    error_code TEXT,
    detail_json TEXT NOT NULL DEFAULT '{}',
    duration_ms BIGINT NOT NULL,
    checked_by TEXT NOT NULL,
    checked_at TEXT NOT NULL DEFAULT utc_now(),
    PRIMARY KEY (connection_id, kind),
    CHECK ((status = 'passed' AND error_code IS NULL)
        OR (status = 'failed' AND error_code IS NOT NULL))
);
