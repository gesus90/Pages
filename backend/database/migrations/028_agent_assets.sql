CREATE TABLE agent_assets (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('staged', 'linked', 'expired')),
    file_name TEXT NOT NULL,
    content_type TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('media', 'file')),
    size BIGINT NOT NULL,
    checksum TEXT NOT NULL,
    storage_name TEXT NOT NULL,
    expires_at BIGINT NOT NULL,
    page_id TEXT,
    attachment_id TEXT,
    created_at BIGINT NOT NULL
);

CREATE INDEX agent_assets_expiry ON agent_assets (status, expires_at);

CREATE TABLE agent_operation_keys (
    user_id TEXT NOT NULL,
    operation_id TEXT NOT NULL,
    operation TEXT NOT NULL,
    fingerprint TEXT NOT NULL,
    result_json TEXT NOT NULL,
    created_at BIGINT NOT NULL,
    PRIMARY KEY (user_id, operation_id)
);
