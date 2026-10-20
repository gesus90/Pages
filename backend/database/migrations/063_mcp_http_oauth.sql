-- Public HTTP MCP uses the existing personal connection audit and revocation.
-- Only hashes of authorization codes and access tokens are persisted.
CREATE TABLE mcp_http_clients (
    id TEXT PRIMARY KEY,
    metadata TEXT NOT NULL,
    expires_at BIGINT NOT NULL
);

CREATE TABLE mcp_http_codes (
    code_hash TEXT PRIMARY KEY,
    parameters TEXT NOT NULL,
    expires_at BIGINT NOT NULL
);

CREATE TABLE mcp_http_access (
    token_hash TEXT PRIMARY KEY,
    resource TEXT NOT NULL,
    expires_at BIGINT NOT NULL
);
