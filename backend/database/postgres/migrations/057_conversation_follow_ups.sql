-- PAGE-337, PAGE-349: agents in a group may address each other with @ again
-- and again; bundled follow-ups to questions and stored hand-overs.

-- Contributions without @ (observer, decision model) per round; @ hand-overs
-- are not counted.
ALTER TABLE conversation_reply_settings
    ADD COLUMN replies_per_round INTEGER NOT NULL DEFAULT 8
        CHECK (replies_per_round BETWEEN 1 AND 9);

-- An agent starts at most once per message that asks it, not once per round.
ALTER TABLE conversation_reply_targets
    DROP CONSTRAINT conversation_reply_targets_pkey,
    ADD PRIMARY KEY (origin_message_id, agent_id, trigger_message_id);

CREATE UNIQUE INDEX conversation_reply_targets_trigger_agent
    ON conversation_reply_targets (trigger_message_id, agent_id);

-- Every explicit @ hand-over between agents is stored before it starts:
-- pending until claimed, paused at the chain pause or after a restart, done
-- once its answer is claimed. The next message of a person starts the paused
-- ones, each exactly once.
CREATE TABLE conversation_handoff_requests (
    trigger_message_id TEXT NOT NULL REFERENCES conversation_messages (id) ON DELETE CASCADE,
    agent_id TEXT NOT NULL,
    origin_message_id TEXT NOT NULL REFERENCES conversation_reply_rounds (origin_message_id) ON DELETE CASCADE,
    conversation_id TEXT NOT NULL REFERENCES conversations (id) ON DELETE CASCADE,
    requested_by TEXT,
    reason TEXT NOT NULL DEFAULT '',
    state TEXT NOT NULL DEFAULT 'pending'
        CHECK (state IN ('pending', 'paused', 'done')),
    pause_reason TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (trigger_message_id, agent_id)
);

CREATE INDEX conversation_handoff_requests_paused
    ON conversation_handoff_requests (conversation_id) WHERE state = 'paused';

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

CREATE INDEX conversation_follow_up_answers_reply
    ON conversation_follow_up_answers (reply_message_id);

-- round_limit stays a valid stored notice type; the chat never shows it.
ALTER TABLE conversation_messages
    DROP CONSTRAINT conversation_messages_notice_check,
    ADD CONSTRAINT conversation_messages_notice_check
        CHECK (notice IS NULL OR notice IN (
            'agent_inactive', 'agent_cost_limit', 'agent_unavailable',
            'agent_failed', 'agent_stopped', 'round_limit'
        ));
