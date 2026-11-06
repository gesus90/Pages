-- PAGE-239: the identity of an open console outlives the API process, so the
-- unchanged browser client reattaches after an API restart. It names owner,
-- target, geometry, attempt and the last event number; no output, no input,
-- no credential. The shell itself does not survive: a restored console starts
-- a fresh shell after the API authorized its owner and target again. A guided
-- setup console is never stored, because its command never runs twice.
CREATE TABLE remote_console_sessions (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL,
    scope_kind TEXT NOT NULL CHECK (scope_kind IN ('workspace', 'connection')),
    scope_id TEXT NOT NULL,
    column_count INTEGER NOT NULL CHECK (column_count BETWEEN 2 AND 500),
    row_count INTEGER NOT NULL CHECK (row_count BETWEEN 2 AND 300),
    attempts INTEGER NOT NULL CHECK (attempts >= 0),
    last_sequence BIGINT NOT NULL CHECK (last_sequence >= 0),
    expires_at TEXT NOT NULL
);

CREATE INDEX remote_console_sessions_owner
    ON remote_console_sessions (owner_id);
CREATE INDEX remote_console_sessions_expiry
    ON remote_console_sessions (expires_at);
