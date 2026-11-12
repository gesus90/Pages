-- PAGE-311: agents read and send messages in conversations with the Pages
-- tools. A conversation of agents only is paused after a chain of agent
-- messages; agent_resume_sequence is the sequence of the newest message at the
-- moment a person allowed it to go on, so only messages after it count to the
-- chain. The hourly limit of messages one agent sends is one instance setting.
ALTER TABLE conversations
    ADD COLUMN agent_resume_sequence BIGINT NOT NULL DEFAULT 0;

CREATE TABLE agent_chat_settings (
    id INTEGER NOT NULL,
    hourly_message_limit INTEGER NOT NULL DEFAULT 30,
    revision INTEGER NOT NULL DEFAULT 1,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    CHECK (id = 1),
    CHECK (hourly_message_limit BETWEEN 1 AND 1000)
);

INSERT INTO agent_chat_settings (id) VALUES (1);

-- Counting the messages an agent sent in the last hour reads its newest ones.
CREATE INDEX conversation_messages_sender ON conversation_messages (sender_id, created_at);
