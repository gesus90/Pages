-- The files of a checked web export package of a chat message. The manifest
-- is the attachment itself; its files lie in the file store of the chat and
-- are never served from the attachment paths, only to a started player.
CREATE TABLE conversation_web_package_files (
    attachment_id TEXT NOT NULL,
    path TEXT NOT NULL,
    storage_name TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    size_bytes BIGINT NOT NULL,
    sha256 TEXT NOT NULL,
    PRIMARY KEY (attachment_id, path),
    UNIQUE (storage_name),
    FOREIGN KEY (attachment_id) REFERENCES conversation_attachments (id) ON DELETE CASCADE,
    CHECK (size_bytes BETWEEN 1 AND 134217728),
    CHECK (char_length(path) BETWEEN 1 AND 100),
    CHECK (char_length(sha256) = 64)
);

-- One start of a player: a secret of limited time for one member and one
-- package. Only the SHA-256 of the secret is stored.
CREATE TABLE conversation_web_package_grants (
    token_hash TEXT NOT NULL,
    attachment_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    revoked_at TEXT,
    PRIMARY KEY (token_hash),
    FOREIGN KEY (attachment_id) REFERENCES conversation_attachments (id) ON DELETE CASCADE,
    CHECK (char_length(token_hash) = 64)
);

CREATE INDEX conversation_web_package_grants_expiry ON conversation_web_package_grants (expires_at);
