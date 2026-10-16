ALTER TABLE personal_agent_tokens ADD COLUMN source TEXT DEFAULT 'manual';
ALTER TABLE personal_agent_tokens ADD COLUMN device_label TEXT;
ALTER TABLE personal_agent_tokens ADD COLUMN last_used_at BIGINT;
ALTER TABLE personal_agent_tokens ADD COLUMN rotated_at BIGINT;
ALTER TABLE personal_agent_tokens ADD COLUMN rotation_requested_at BIGINT;
ALTER TABLE personal_agent_tokens ADD COLUMN previous_token_hash TEXT;
ALTER TABLE personal_agent_tokens ADD COLUMN previous_valid_until BIGINT;

CREATE TABLE mcp_pairing_preferences (
    user_id TEXT PRIMARY KEY,
    validity_days INTEGER NOT NULL CHECK (validity_days BETWEEN 0 AND 365)
);

CREATE TABLE mcp_pairing_requests (
    id TEXT PRIMARY KEY,
    user_code_hash TEXT NOT NULL UNIQUE,
    device_secret_hash TEXT NOT NULL,
    client_name TEXT NOT NULL,
    device_label TEXT NOT NULL,
    package_version TEXT NOT NULL,
    created_at BIGINT NOT NULL,
    expires_at BIGINT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'denied', 'cancelled', 'consumed', 'expired')),
    user_id TEXT,
    decided_at BIGINT,
    approved_name TEXT,
    approved_validity_seconds BIGINT,
    csrf_hash TEXT,
    last_poll_at BIGINT,
    poll_interval INTEGER NOT NULL DEFAULT 5,
    token_id TEXT
);
