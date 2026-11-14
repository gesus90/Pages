-- PAGE-359: durable session watermarks and immutable per-turn prices.
CREATE TABLE claude_usage_sessions (
    session_id TEXT PRIMARY KEY,
    state TEXT NOT NULL
);

CREATE TABLE openrouter_price_catalog (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    fetched_at TEXT NOT NULL,
    catalog TEXT NOT NULL
);

ALTER TABLE agent_session_turn_usage
    ADD COLUMN claude_accounting TEXT;

ALTER TABLE agent_connections
    ADD COLUMN claude_price_models TEXT NOT NULL DEFAULT '{}';

ALTER TABLE agent_session_attempts
    ADD COLUMN connection_id TEXT,
    ADD COLUMN requested_model TEXT;

-- The PAGE-283 removal stays intact for all other providers.
ALTER TABLE agent_employees
    ADD COLUMN claude_monthly_cost_limit DOUBLE PRECISION
        CHECK (claude_monthly_cost_limit IS NULL OR claude_monthly_cost_limit >= 0);

CREATE INDEX agent_session_attempts_claude_account
    ON agent_session_attempts (user_id, provider);
