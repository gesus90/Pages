-- The chat page reopens where a person stopped: the chat they used last is
-- kept next to the split width and the state of the list, and for each chat
-- they left scrolled up, the message at the top of its history. A chat read to
-- its end has no entry.
ALTER TABLE chat_view_settings
    ADD COLUMN last_chat_kind TEXT,
    ADD COLUMN last_chat_id TEXT,
    ADD CONSTRAINT chat_view_settings_last_chat_check
        CHECK (
            (last_chat_kind IS NULL AND last_chat_id IS NULL)
            OR (
                last_chat_kind IN ('group', 'participant')
                AND last_chat_id IS NOT NULL
                AND char_length(last_chat_id) <= 200
            )
        );

CREATE TABLE chat_reading_positions (
    user_id TEXT NOT NULL,
    chat_key TEXT NOT NULL,
    message_id TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (user_id, chat_key),
    CHECK (char_length(chat_key) <= 220),
    CHECK (char_length(message_id) <= 200)
);

CREATE INDEX chat_reading_positions_recent
    ON chat_reading_positions (user_id, updated_at DESC);
