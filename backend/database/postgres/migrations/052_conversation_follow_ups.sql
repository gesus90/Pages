-- PAGE-337: bounded, durable follow-ups to questions in a group round.
ALTER TABLE conversation_reply_settings
    ADD COLUMN replies_per_agent INTEGER NOT NULL DEFAULT 4
        CHECK (replies_per_agent BETWEEN 1 AND 4),
    ADD COLUMN replies_per_round INTEGER NOT NULL DEFAULT 8
        CHECK (replies_per_round BETWEEN 1 AND 9);

ALTER TABLE conversation_reply_rounds
    ADD COLUMN ended_at TEXT;

ALTER TABLE conversation_reply_targets
    DROP CONSTRAINT conversation_reply_targets_pkey,
    ADD PRIMARY KEY (origin_message_id, agent_id, trigger_message_id);

CREATE TABLE conversation_follow_up_questions (
    question_message_id TEXT PRIMARY KEY REFERENCES conversation_messages (id) ON DELETE CASCADE,
    origin_message_id TEXT NOT NULL REFERENCES conversation_reply_rounds (origin_message_id) ON DELETE CASCADE,
    conversation_id TEXT NOT NULL REFERENCES conversations (id) ON DELETE CASCADE,
    agent_id TEXT NOT NULL,
    deadline_at TEXT NOT NULL,
    consumed_at TEXT
);

CREATE TABLE conversation_follow_up_answers (
    question_message_id TEXT NOT NULL REFERENCES conversation_follow_up_questions (question_message_id) ON DELETE CASCADE,
    agent_id TEXT NOT NULL,
    reply_message_id TEXT REFERENCES conversation_messages (id) ON DELETE SET NULL,
    PRIMARY KEY (question_message_id, agent_id)
);

CREATE INDEX conversation_follow_up_questions_pending
    ON conversation_follow_up_questions (deadline_at) WHERE consumed_at IS NULL;

ALTER TABLE conversation_messages
    DROP CONSTRAINT conversation_messages_notice_check,
    ADD CONSTRAINT conversation_messages_notice_check
        CHECK (notice IS NULL OR notice IN (
            'agent_inactive', 'agent_cost_limit', 'agent_unavailable',
            'agent_failed', 'agent_stopped', 'round_limit'
        ));
