-- OpenCode as a third CLI runner (PAGE-47). DuckDB cannot change a CHECK
-- constraint, so the table is rebuilt with the same columns and rows. Like the
-- other CLI connections, an OpenCode connection stores no secret: its provider
-- key lives in the private credential folder of the connection.
CREATE TABLE agent_connections_next (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    provider TEXT NOT NULL CHECK (provider IN (
        'openrouter', 'openai', 'google_ai_studio', 'zai', 'anthropic',
        'codex_cli', 'claude_code', 'opencode'
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
    CHECK (
        (provider IN ('codex_cli', 'claude_code', 'opencode') AND secret_encrypted IS NULL)
        OR (provider NOT IN ('codex_cli', 'claude_code', 'opencode')
            AND secret_encrypted IS NOT NULL
            AND cli_logged_in_at IS NULL
            AND cli_account_label IS NULL)
    )
);

INSERT INTO agent_connections_next (
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
    is_active
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
    is_active
FROM agent_connections;

DROP TABLE agent_connections;
ALTER TABLE agent_connections_next RENAME TO agent_connections;
CREATE UNIQUE INDEX agent_connections_name_lower ON agent_connections (lower(name));
