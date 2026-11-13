-- PAGE-379: who answers in a group chat. Two modes per group instead of three:
-- `mentions` (only agents named with @ answer) and `decision` (like mentions,
-- and the decision model of the instance decides for a message of a person
-- without an @). The observer of PAGE-296 is part of `decision` now; a group
-- that kept `observer` or `decision` has `decision`, one with `mentions`
-- keeps it.
--
-- The decision model is an OpenRouter decision model (output modality
-- `decisions`), so a chat model chosen under PAGE-317 no longer fits and the
-- choice is cleared: the groups behave like `mentions` until an administrator
-- chooses a decision model. The thresholds are whole percents; a group without
-- values of its own follows the defaults of the instance.
UPDATE chat_decision_settings
SET connection_id = NULL,
    model = NULL,
    reasoning_effort = NULL,
    revision = revision + 1,
    updated_at = CURRENT_TIMESTAMP;

ALTER TABLE chat_decision_settings
    ADD COLUMN answer_threshold INTEGER NOT NULL DEFAULT 60,
    ADD COLUMN responsibility_threshold INTEGER NOT NULL DEFAULT 50,
    ADD COLUMN second_threshold INTEGER NOT NULL DEFAULT 40,
    ADD COLUMN max_responders INTEGER NOT NULL DEFAULT 2,
    ADD CONSTRAINT chat_decision_settings_answer_threshold_check
        CHECK (answer_threshold BETWEEN 0 AND 100),
    ADD CONSTRAINT chat_decision_settings_responsibility_threshold_check
        CHECK (responsibility_threshold BETWEEN 0 AND 100),
    ADD CONSTRAINT chat_decision_settings_second_threshold_check
        CHECK (second_threshold BETWEEN 0 AND 100),
    ADD CONSTRAINT chat_decision_settings_max_responders_check
        CHECK (max_responders BETWEEN 1 AND 3);

-- The settings of a group. A column without a value follows the default of the
-- instance. The earlier default of two answering agents was never a choice of
-- the group, so it is not kept as one. The default responder is gone: without a
-- usable decision model a group behaves like `mentions`.
UPDATE conversation_reply_settings
SET mode = 'decision'
WHERE mode IN ('observer', 'decision');

ALTER TABLE conversation_reply_settings
    DROP CONSTRAINT conversation_reply_settings_mode_check,
    DROP CONSTRAINT conversation_reply_settings_max_responders_check,
    ALTER COLUMN mode SET DEFAULT 'decision',
    ALTER COLUMN max_responders DROP NOT NULL,
    ALTER COLUMN max_responders DROP DEFAULT,
    DROP COLUMN default_responder_id,
    ADD COLUMN answer_threshold INTEGER,
    ADD COLUMN responsibility_threshold INTEGER,
    ADD COLUMN second_threshold INTEGER,
    ADD CONSTRAINT conversation_reply_settings_mode_check
        CHECK (mode IN ('mentions', 'decision')),
    ADD CONSTRAINT conversation_reply_settings_max_responders_check
        CHECK (max_responders IS NULL OR max_responders BETWEEN 1 AND 3),
    ADD CONSTRAINT conversation_reply_settings_answer_threshold_check
        CHECK (answer_threshold IS NULL OR answer_threshold BETWEEN 0 AND 100),
    ADD CONSTRAINT conversation_reply_settings_responsibility_threshold_check
        CHECK (responsibility_threshold IS NULL OR responsibility_threshold BETWEEN 0 AND 100),
    ADD CONSTRAINT conversation_reply_settings_second_threshold_check
        CHECK (second_threshold IS NULL OR second_threshold BETWEEN 0 AND 100);

UPDATE conversation_reply_settings
SET max_responders = NULL
WHERE max_responders = 2;

-- Every decision about a message of a group, one per message. `outcome` is
-- `responders` (agents answer), `nobody` (the model or the thresholds chose
-- nobody), `mention` (the person addressed agents with @, no model asked) or
-- `unavailable` (no usable model; the group behaved like `mentions`).
-- `answer_probability` is the chance that the message expects an answer of an
-- agent, `choices` the probability of each agent and of nobody as JSON
-- (`agentId` null is nobody), `model` the decision model that answered.
-- Decisions the old model took keep their agents; one that fell back to a
-- default responder or to a hint becomes `unavailable` or `nobody`. The old
-- checks go first, because the rewritten values would fail them.
ALTER TABLE conversation_reply_decisions
    DROP CONSTRAINT conversation_reply_decisions_outcome_check,
    DROP CONSTRAINT conversation_reply_decisions_fallback_check;

UPDATE conversation_reply_decisions
SET outcome = 'unavailable',
    responders = '[]'
WHERE outcome IN ('default', 'notice')
    AND fallback IN ('no_model', 'model_failed');

UPDATE conversation_reply_decisions
SET outcome = 'responders',
    fallback = 'none'
WHERE outcome = 'default';

UPDATE conversation_reply_decisions
SET outcome = 'nobody',
    fallback = 'none'
WHERE outcome = 'notice';

UPDATE conversation_reply_decisions
SET fallback = 'none'
WHERE fallback = 'unclear';

ALTER TABLE conversation_reply_decisions
    DROP COLUMN suggested,
    DROP COLUMN reason,
    DROP COLUMN needs_answer,
    ADD COLUMN model TEXT,
    ADD COLUMN answer_probability DOUBLE PRECISION,
    ADD COLUMN choices TEXT NOT NULL DEFAULT '[]',
    ADD CONSTRAINT conversation_reply_decisions_outcome_check
        CHECK (outcome IN ('responders', 'nobody', 'mention', 'unavailable')),
    ADD CONSTRAINT conversation_reply_decisions_fallback_check
        CHECK (fallback IN ('none', 'no_model', 'model_failed'));

CREATE INDEX conversation_reply_decisions_recent
    ON conversation_reply_decisions (conversation_id, created_at DESC);
