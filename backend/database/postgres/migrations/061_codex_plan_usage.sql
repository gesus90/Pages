-- PAGE-362: immutable price snapshots and one cumulative watermark per managed Codex thread.
CREATE TABLE openrouter_price_catalog (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    payload TEXT NOT NULL
);

CREATE TABLE codex_thread_usage (
    connection_id TEXT NOT NULL,
    thread_id TEXT NOT NULL,
    totals TEXT NOT NULL,
    PRIMARY KEY (connection_id, thread_id)
);

CREATE TABLE codex_prompt_baselines (
    attempt_id TEXT NOT NULL REFERENCES agent_session_attempts(attempt_id) ON DELETE CASCADE,
    turn INTEGER NOT NULL,
    totals TEXT NOT NULL,
    PRIMARY KEY (attempt_id, turn)
);

CREATE TABLE codex_plan_prices (
    attempt_id TEXT NOT NULL REFERENCES agent_session_attempts(attempt_id) ON DELETE CASCADE,
    model TEXT NOT NULL,
    price TEXT NOT NULL,
    PRIMARY KEY (attempt_id, model)
);

ALTER TABLE agent_session_attempts
    ADD COLUMN connection_id TEXT,
    ADD COLUMN agent_id TEXT,
    ADD COLUMN requested_model TEXT;

ALTER TABLE agent_session_turn_usage
    ADD COLUMN reasoning_tokens BIGINT,
    ADD COLUMN codex_accounting TEXT;

ALTER TABLE agent_connections
    ADD COLUMN codex_price_mappings TEXT NOT NULL DEFAULT '{}';
