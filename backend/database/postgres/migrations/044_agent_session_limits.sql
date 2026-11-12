-- PAGE-304: an agent answers in several chats at once, one session per chat
-- and agent. One row holds how many sessions run at the same time per agent
-- and for all agents together; above a limit a message waits, it is never
-- refused.
CREATE TABLE agent_session_settings (
    id INTEGER NOT NULL,
    per_agent_limit INTEGER NOT NULL DEFAULT 4,
    total_limit INTEGER NOT NULL DEFAULT 16,
    revision INTEGER NOT NULL DEFAULT 1,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    CHECK (id = 1),
    CHECK (per_agent_limit BETWEEN 1 AND 64),
    CHECK (total_limit BETWEEN 1 AND 64),
    CHECK (per_agent_limit <= total_limit)
);

INSERT INTO agent_session_settings (id) VALUES (1);

-- A member can stop the answer of an agent in a conversation; the agent then
-- leaves this hint instead of an answer.
ALTER TABLE conversation_messages
    DROP CONSTRAINT conversation_messages_notice_check;

ALTER TABLE conversation_messages
    ADD CONSTRAINT conversation_messages_notice_check
    CHECK (notice IS NULL OR notice IN ('agent_inactive', 'agent_cost_limit', 'agent_unavailable', 'agent_failed', 'agent_stopped'));
