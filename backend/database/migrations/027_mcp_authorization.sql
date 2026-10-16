CREATE TABLE personal_agent_tokens (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    name TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    created_at BIGINT NOT NULL,
    expires_at BIGINT,
    revoked_at BIGINT
);

CREATE TABLE mcp_oauth_clients (
    id TEXT PRIMARY KEY,
    metadata TEXT NOT NULL
);

CREATE TABLE mcp_oauth_flows (
    id TEXT PRIMARY KEY,
    parameters TEXT NOT NULL,
    expires_at BIGINT NOT NULL,
    user_id TEXT,
    csrf_hash TEXT,
    completed_at BIGINT
);

CREATE TABLE mcp_oauth_preferences (
    user_id TEXT PRIMARY KEY,
    duration_seconds BIGINT
);

CREATE TABLE mcp_oauth_grants (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    client_id TEXT NOT NULL,
    resource TEXT NOT NULL,
    verified_at BIGINT NOT NULL,
    expires_at BIGINT,
    ended_at BIGINT,
    status TEXT NOT NULL CHECK (status IN ('active', 'expired', 'revoked'))
);

CREATE TABLE mcp_oauth_credentials (
    token_hash TEXT PRIMARY KEY,
    grant_id TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('code', 'access', 'refresh', 'delegation')),
    audience TEXT NOT NULL,
    expires_at BIGINT NOT NULL,
    used_at BIGINT,
    parameters TEXT NOT NULL
);
