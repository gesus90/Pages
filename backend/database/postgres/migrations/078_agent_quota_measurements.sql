-- The latest measurement series and forecast for each reported quota window.
-- Each connection's complete measurement is replaced together.
CREATE TABLE agent_quota_measurements (
    connection_id TEXT PRIMARY KEY REFERENCES agent_connections (id) ON DELETE CASCADE,
    observed_at BIGINT NOT NULL,
    credential_revision TEXT,
    windows JSONB NOT NULL,
    zai_reading JSONB
);
