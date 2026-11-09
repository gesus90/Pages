-- PAGE-278: stored conversations between people and agents, shared by the web
-- chat page and Pica Mobile (conversations.v1). A direct conversation exists
-- once per pair; its key is the two account IDs in sorted order. A group has a
-- name and members; every member sees the same history. Pica's own chat tables
-- stay untouched. Times are ISO 8601 with milliseconds.
CREATE TABLE conversations (
    id TEXT NOT NULL,
    kind TEXT NOT NULL,
    name TEXT NOT NULL DEFAULT '',
    direct_key TEXT,
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL,
    last_activity_at TEXT NOT NULL,
    PRIMARY KEY (id),
    UNIQUE (direct_key),
    CHECK (kind IN ('direct', 'group')),
    CHECK ((kind = 'direct') = (direct_key IS NOT NULL)),
    CHECK (char_length(name) <= 80)
);

-- Muting and the read state belong to one member of one conversation; the read
-- state is the sequence of the newest message the member has read.
CREATE TABLE conversation_members (
    conversation_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    joined_at TEXT NOT NULL,
    is_muted BOOLEAN NOT NULL DEFAULT FALSE,
    read_sequence BIGINT NOT NULL DEFAULT 0,
    PRIMARY KEY (conversation_id, user_id),
    FOREIGN KEY (conversation_id) REFERENCES conversations (id) ON DELETE CASCADE
);

CREATE INDEX conversation_members_user ON conversation_members (user_id);

-- The sequence orders messages across conversations and counts unread ones.
-- A repeated clientMessageId of the same sender in the same conversation is the
-- same message. Voice audio lies in the file store of Pages, never in a row;
-- its text arrives after the sending.
CREATE TABLE conversation_messages (
    id TEXT NOT NULL,
    sequence BIGINT GENERATED ALWAYS AS IDENTITY,
    conversation_id TEXT NOT NULL,
    sender_id TEXT NOT NULL,
    client_message_id TEXT NOT NULL,
    text TEXT NOT NULL DEFAULT '',
    mentions TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL,
    voice_storage_name TEXT,
    voice_mime_type TEXT,
    voice_size_bytes BIGINT,
    voice_duration_ms INTEGER,
    transcription_state TEXT,
    PRIMARY KEY (id),
    UNIQUE (sequence),
    UNIQUE (conversation_id, sender_id, client_message_id),
    FOREIGN KEY (conversation_id) REFERENCES conversations (id) ON DELETE CASCADE,
    CHECK (char_length(text) <= 16000),
    CHECK (transcription_state IS NULL OR transcription_state IN ('pending', 'done', 'failed')),
    CHECK ((voice_storage_name IS NULL) = (transcription_state IS NULL))
);

CREATE INDEX conversation_messages_history ON conversation_messages (conversation_id, sequence);
