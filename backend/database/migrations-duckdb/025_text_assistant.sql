CREATE TABLE text_assistant_settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    connection_id TEXT,
    model TEXT,
    reasoning_effort TEXT,
    retention_days INTEGER NOT NULL DEFAULT 30 CHECK (retention_days BETWEEN 1 AND 365)
);

INSERT INTO text_assistant_settings (id) VALUES (1);

CREATE TABLE text_assistant_preferences (
    user_id TEXT PRIMARY KEY,
    auto_apply BOOLEAN NOT NULL DEFAULT FALSE,
    target_language TEXT NOT NULL DEFAULT 'de'
);

CREATE TABLE assistant_conversations (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    context_kind TEXT NOT NULL CHECK (context_kind IN ('wiki', 'ticket')),
    context_id TEXT NOT NULL,
    last_message_at TEXT NOT NULL DEFAULT utc_now()
);

CREATE INDEX assistant_conversation_owner
ON assistant_conversations (user_id, context_kind, context_id);

CREATE TABLE assistant_messages (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
    content TEXT NOT NULL,
    change_kind TEXT NOT NULL CHECK (change_kind IN ('answer', 'replace', 'insert')),
    created_at TEXT NOT NULL DEFAULT utc_now(),
    position INTEGER NOT NULL
);
