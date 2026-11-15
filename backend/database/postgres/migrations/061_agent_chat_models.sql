-- PAGE-380: the model of an agent per chat, who steers the sessions of a group
-- and the system lines of the chat.
--
-- An agent answers with its own model until a person chooses another one for
-- one chat: its direct chat with a person (chat_kind 'direct', chat_id the
-- person) or a group (chat_kind 'group', chat_id the conversation). The choice
-- lasts until somebody resets it, across resting sessions and restarts of
-- Pages. Removing the agent from a group or dissolving the group deletes it.
CREATE TABLE agent_chat_models (
    agent_id TEXT NOT NULL,
    chat_kind TEXT NOT NULL,
    chat_id TEXT NOT NULL,
    connection_id TEXT NOT NULL,
    model TEXT NOT NULL,
    reasoning_effort TEXT,
    changed_by TEXT NOT NULL,
    changed_at TEXT NOT NULL,
    PRIMARY KEY (agent_id, chat_kind, chat_id),
    CHECK (chat_kind IN ('direct', 'group')),
    CHECK (char_length(model) BETWEEN 1 AND 300)
);

CREATE INDEX agent_chat_models_chat ON agent_chat_models (chat_kind, chat_id);

-- The members of a group the one who created it allows to change the model of
-- its agents and to restart and compact their sessions. The creator may
-- always; without a row nobody else may.
CREATE TABLE conversation_session_controllers (
    conversation_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    added_at TEXT NOT NULL,
    PRIMARY KEY (conversation_id, user_id),
    FOREIGN KEY (conversation_id) REFERENCES conversations (id) ON DELETE CASCADE
);

-- A system line of a chat: a person changed the model of an agent, restarted
-- or compacted its session, or removed a member. It never asks an agent.
ALTER TABLE conversation_messages
    DROP CONSTRAINT conversation_messages_notice_check,
    ADD CONSTRAINT conversation_messages_notice_check
        CHECK (notice IS NULL OR notice IN (
            'agent_inactive', 'agent_cost_limit', 'agent_unavailable',
            'agent_failed', 'agent_stopped', 'round_limit', 'session_event'
        ));
