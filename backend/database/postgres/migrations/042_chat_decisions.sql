-- PAGE-317: who answers in a group chat. The decision model is one setting of
-- the instance next to the speech recognition: without a model every message
-- of a person without an @ falls back to the default responder of the group.
-- The model has no tools and runs no action; it only chooses agents.
CREATE TABLE chat_decision_settings (
    id INTEGER NOT NULL,
    connection_id TEXT,
    model TEXT,
    reasoning_effort TEXT,
    revision INTEGER NOT NULL DEFAULT 1,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    CHECK (id = 1),
    CHECK ((connection_id IS NULL) = (model IS NULL))
);

INSERT INTO chat_decision_settings (id) VALUES (1);

-- How one group decides who answers a message without an @. A group without a
-- row keeps the observer of PAGE-296, which is the behavior before this
-- setting. default_responder_id is an agent member of the group or none.
CREATE TABLE conversation_reply_settings (
    conversation_id TEXT NOT NULL,
    mode TEXT NOT NULL DEFAULT 'observer',
    default_responder_id TEXT,
    max_responders INTEGER NOT NULL DEFAULT 2,
    updated_by TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (conversation_id),
    FOREIGN KEY (conversation_id) REFERENCES conversations (id) ON DELETE CASCADE,
    CHECK (mode IN ('mentions', 'observer', 'decision')),
    CHECK (max_responders BETWEEN 1 AND 3)
);

-- Every decision of the decision model, one per message: the key holds it
-- against repeated events and a restart. responders and suggested hold agent
-- IDs as JSON; reason is the one sentence of the model, never the prompt.
CREATE TABLE conversation_reply_decisions (
    message_id TEXT NOT NULL,
    conversation_id TEXT NOT NULL,
    outcome TEXT NOT NULL,
    fallback TEXT NOT NULL DEFAULT 'none',
    responders TEXT NOT NULL DEFAULT '[]',
    suggested TEXT NOT NULL DEFAULT '[]',
    reason TEXT NOT NULL DEFAULT '',
    needs_answer BOOLEAN,
    created_at TEXT NOT NULL,
    PRIMARY KEY (message_id),
    FOREIGN KEY (message_id) REFERENCES conversation_messages (id) ON DELETE CASCADE,
    FOREIGN KEY (conversation_id) REFERENCES conversations (id) ON DELETE CASCADE,
    CHECK (outcome IN ('responders', 'default', 'notice', 'nobody')),
    CHECK (fallback IN ('none', 'no_model', 'model_failed', 'unclear')),
    CHECK (char_length(reason) <= 300)
);

CREATE INDEX conversation_reply_decisions_conversation ON conversation_reply_decisions (conversation_id);

-- The default responder answers with the trigger fallback, so its answer says
-- that it was unclear who was addressed.
ALTER TABLE conversation_reply_targets
    DROP CONSTRAINT conversation_reply_targets_trigger_check;

ALTER TABLE conversation_reply_targets
    ADD CONSTRAINT conversation_reply_targets_trigger_check
    CHECK (trigger IN ('direct', 'mention', 'context', 'handoff', 'fallback'));
