CREATE TABLE chat_settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    attachment_limit_bytes BIGINT NOT NULL DEFAULT 16777216 CHECK (
        attachment_limit_bytes BETWEEN 1048576 AND 536870912
    ),
    system_instruction TEXT,
    updated_at TEXT NOT NULL DEFAULT utc_now()
);

INSERT INTO chat_settings (id) VALUES (1);

CREATE TABLE chat_sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT utc_now(),
    last_message_at TEXT NOT NULL DEFAULT utc_now()
);

CREATE INDEX chat_session_owner ON chat_sessions (user_id);

CREATE TABLE chat_messages (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    position INTEGER NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
    content TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT utc_now()
);

CREATE INDEX chat_message_session ON chat_messages (session_id);

CREATE TABLE chat_attachments (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    message_id TEXT,
    file_name TEXT NOT NULL,
    content_type TEXT NOT NULL,
    size BIGINT NOT NULL,
    storage_name TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT utc_now()
);

CREATE INDEX chat_attachment_session ON chat_attachments (session_id);
