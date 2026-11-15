CREATE TABLE agent_opencode_message_usage (
    message_id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    attempt_id TEXT NOT NULL REFERENCES agent_session_attempts(attempt_id) ON DELETE CASCADE,
    turn INTEGER NOT NULL,
    model TEXT,
    input_tokens BIGINT,
    output_tokens BIGINT,
    reasoning_tokens BIGINT,
    cache_read_tokens BIGINT,
    cache_write_tokens BIGINT,
    cost_usd DOUBLE PRECISION,
    price_state TEXT NOT NULL,
    price_as_of TEXT,
    reported_at TEXT NOT NULL
);

CREATE INDEX agent_opencode_message_usage_attempt_idx
    ON agent_opencode_message_usage (attempt_id);

ALTER TABLE agent_connections
    ADD COLUMN openrouter_model_ids JSONB NOT NULL DEFAULT '{}'::jsonb;
