-- PAGE-376: an agent keeps exactly one chat session per direct chat and per
-- group (one row of agent_conversations). The row now also holds the state
-- of that session: the newest conversation message the session received
-- (delivered_sequence, so a round carries only what is new), whether its
-- context reached the restart threshold (needs_restart), how full its context
-- was after the last round and the tokens it used. last_activity_at is the
-- moment of its last round. All times are ISO 8601 in UTC.
ALTER TABLE agent_conversations
    ADD COLUMN delivered_sequence BIGINT NOT NULL DEFAULT 0,
    ADD COLUMN needs_restart BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN context_used BIGINT,
    ADD COLUMN context_size BIGINT,
    ADD COLUMN tokens_total BIGINT NOT NULL DEFAULT 0,
    ADD COLUMN tokens_today BIGINT NOT NULL DEFAULT 0,
    ADD COLUMN tokens_day TEXT,
    ADD COLUMN restart_count INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN last_activity_at TEXT;

-- Per agent: the minutes without a message until the process of a session
-- ends (NULL follows the instance setting) and the context fill, in percent,
-- at which a session summarizes and restarts.
ALTER TABLE agent_employees
    ADD COLUMN chat_idle_minutes INTEGER,
    ADD COLUMN chat_restart_percent INTEGER NOT NULL DEFAULT 80,
    ADD CONSTRAINT agent_employees_chat_idle_minutes_check
        CHECK (chat_idle_minutes IS NULL OR chat_idle_minutes BETWEEN 1 AND 1440),
    ADD CONSTRAINT agent_employees_chat_restart_percent_check
        CHECK (chat_restart_percent BETWEEN 10 AND 95);

-- The instance setting is the default of agents without an idle time of
-- their own; a resting session now keeps its identifier for 30 minutes.
ALTER TABLE agent_session_settings
    ALTER COLUMN idle_minutes SET DEFAULT 30;

UPDATE agent_session_settings
SET idle_minutes = 30
WHERE idle_minutes = 10;
