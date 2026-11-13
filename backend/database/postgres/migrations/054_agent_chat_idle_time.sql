-- PAGE-335: an agent keeps one chat session per conversation and answers
-- every round through it. A session without a round ends after this many
-- minutes and releases its process and its reservation; the next round
-- starts it again.
ALTER TABLE agent_session_settings
    ADD COLUMN idle_minutes INTEGER NOT NULL DEFAULT 10,
    ADD CONSTRAINT agent_session_settings_idle_minutes_check
        CHECK (idle_minutes BETWEEN 1 AND 1440);
