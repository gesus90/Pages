-- PAGE-386: agents read the files of a chat, also afterwards from its
-- history, and show earlier attachments again.
--
-- conversation_attachment_texts keeps the text Pages recognized in an
-- attachment once (the text of a document, the rows of a table, the spoken
-- text of a sound or of the sound track of a video), credentials already
-- redacted, so an agent can search the attachments of its chat by a word of
-- their content. The row goes with its attachment.
CREATE TABLE conversation_attachment_texts (
    attachment_id TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (attachment_id),
    FOREIGN KEY (attachment_id) REFERENCES conversation_attachments (id) ON DELETE CASCADE,
    CHECK (char_length(content) <= 400000)
);

-- conversation_attachment_references are the lines of an agent's answer that
-- show an earlier attachment of the same chat again. No copy is made: the row
-- names the original, deliberately without a foreign key, so a reference to
-- an attachment deleted with its message stays and the chat shows "gelöscht"
-- in its place. Name, type, message and sender of the original are kept for
-- that placeholder. The row goes with the answer that holds it.
CREATE TABLE conversation_attachment_references (
    message_id TEXT NOT NULL,
    position INTEGER NOT NULL,
    conversation_id TEXT NOT NULL,
    attachment_id TEXT NOT NULL,
    name TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    source_message_id TEXT NOT NULL,
    source_sender_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (message_id, position),
    FOREIGN KEY (message_id) REFERENCES conversation_messages (id) ON DELETE CASCADE,
    FOREIGN KEY (conversation_id) REFERENCES conversations (id) ON DELETE CASCADE,
    CHECK (position BETWEEN 0 AND 9),
    CHECK (char_length(name) BETWEEN 1 AND 255)
);

CREATE INDEX conversation_attachment_references_attachment
    ON conversation_attachment_references (attachment_id);
