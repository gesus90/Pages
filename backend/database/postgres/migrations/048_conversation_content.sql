-- PAGE-298: content of conversation messages. A message carries up to ten
-- attachments; their bytes and preview images lie in the file store of Pages,
-- never in a row. An attachment is uploaded before its message is sent, so it
-- exists without a message until then; one that never gets a message is swept.
-- Deleting a message or a conversation removes the rows, the service removes
-- the files. Times are ISO 8601 with milliseconds.
CREATE TABLE conversation_attachments (
    id TEXT NOT NULL,
    conversation_id TEXT NOT NULL,
    message_id TEXT,
    uploader_id TEXT NOT NULL,
    name TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    size_bytes BIGINT NOT NULL,
    storage_name TEXT NOT NULL,
    position INTEGER NOT NULL DEFAULT 0,
    thumbnail_storage_name TEXT,
    thumbnail_mime_type TEXT,
    thumbnail_size_bytes BIGINT,
    created_at TEXT NOT NULL,
    PRIMARY KEY (id),
    UNIQUE (storage_name),
    FOREIGN KEY (conversation_id) REFERENCES conversations (id) ON DELETE CASCADE,
    FOREIGN KEY (message_id) REFERENCES conversation_messages (id) ON DELETE CASCADE,
    CHECK (size_bytes BETWEEN 0 AND 536870912),
    CHECK (char_length(name) BETWEEN 1 AND 255),
    CHECK (position BETWEEN 0 AND 9),
    CHECK ((thumbnail_storage_name IS NULL) = (thumbnail_mime_type IS NULL))
);

CREATE INDEX conversation_attachments_message ON conversation_attachments (message_id, position);
CREATE INDEX conversation_attachments_conversation ON conversation_attachments (conversation_id);

-- Domains every member of one conversation may see embedded.
CREATE TABLE conversation_embed_domains (
    conversation_id TEXT NOT NULL,
    domain TEXT NOT NULL,
    added_by TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (conversation_id, domain),
    FOREIGN KEY (conversation_id) REFERENCES conversations (id) ON DELETE CASCADE,
    CHECK (char_length(domain) BETWEEN 1 AND 253)
);

-- Domains an administrator released for every conversation.
CREATE TABLE conversation_global_embed_domains (
    domain TEXT NOT NULL,
    added_by TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (domain),
    CHECK (char_length(domain) BETWEEN 1 AND 253)
);

-- What the server learned about a linked page, fetched once per URL and kept
-- for 24 hours. A row without title, description and image records that the
-- page gave no answer, so it is not asked again before the row expires.
CREATE TABLE conversation_link_previews (
    url TEXT NOT NULL,
    title TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    image_storage_name TEXT,
    image_mime_type TEXT,
    fetched_at TEXT NOT NULL,
    PRIMARY KEY (url),
    CHECK (char_length(url) <= 2000),
    CHECK ((image_storage_name IS NULL) = (image_mime_type IS NULL))
);

-- Whether a person last collapsed or expanded one content card of the chat.
CREATE TABLE chat_card_states (
    user_id TEXT NOT NULL,
    card_key TEXT NOT NULL,
    state TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (user_id, card_key),
    CHECK (state IN ('collapsed', 'expanded')),
    CHECK (char_length(card_key) <= 200)
);

CREATE INDEX chat_card_states_recent ON chat_card_states (user_id, updated_at DESC);

-- The width a person last gave the split view next to the chat, in pixels.
CREATE TABLE chat_view_settings (
    user_id TEXT NOT NULL,
    split_width INTEGER NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (user_id),
    CHECK (split_width BETWEEN 360 AND 10000)
);
