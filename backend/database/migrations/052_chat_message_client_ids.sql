-- The ID the browser gives a message it sends (PAGE-68). A message the browser
-- sends again, because it lost the first answer, is stored only once per
-- conversation. Older messages and answers of Pica carry none.
ALTER TABLE chat_messages ADD COLUMN client_message_id TEXT;

CREATE UNIQUE INDEX chat_message_client_id ON chat_messages (
    session_id,
    client_message_id
);
