CREATE TABLE openrouter_plan_price_catalog (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    fetched_at TEXT NOT NULL,
    prices JSONB NOT NULL
);

CREATE TABLE agent_session_openrouter_usage (
    native_session_id TEXT NOT NULL,
    message_id TEXT NOT NULL,
    attempt_id TEXT NOT NULL,
    model TEXT NOT NULL,
    input_tokens BIGINT NOT NULL,
    output_tokens BIGINT NOT NULL,
    reasoning_tokens BIGINT NOT NULL,
    cache_read_tokens BIGINT NOT NULL,
    cache_write_tokens BIGINT NOT NULL,
    native_cost DOUBLE PRECISION,
    cost_amount DOUBLE PRECISION,
    cost_state TEXT NOT NULL CHECK (cost_state IN ('known', 'free', 'unknown')),
    price_snapshot JSONB,
    priced_at TEXT,
    reported_at TEXT NOT NULL,
    PRIMARY KEY (native_session_id, message_id)
);

CREATE INDEX agent_session_openrouter_usage_attempt_idx
    ON agent_session_openrouter_usage (attempt_id);
