-- PAGE-391: questions of chat agents with answer buttons. The question is a
-- message of the agent in the conversation; this table holds its items, who
-- may answer, and the answer that locks it.

CREATE TABLE agent_chat_questions (
    id TEXT PRIMARY KEY,
    message_id TEXT NOT NULL UNIQUE REFERENCES conversation_messages (id) ON DELETE CASCADE,
    conversation_id TEXT NOT NULL REFERENCES conversations (id) ON DELETE CASCADE,
    agent_id TEXT NOT NULL,
    items TEXT NOT NULL,
    -- The person who addressed the agent; NULL lets every human member answer.
    responder_id TEXT,
    confirms_tool TEXT,
    status TEXT NOT NULL DEFAULT 'open'
        CHECK (status IN ('open', 'answered', 'expired', 'cancelled')),
    answers TEXT,
    answered_by TEXT,
    answered_at TEXT,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE INDEX agent_chat_questions_conversation
    ON agent_chat_questions (conversation_id);
