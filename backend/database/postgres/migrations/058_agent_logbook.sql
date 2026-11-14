-- PAGE-377: the Lagebuch of an agent, one short shared memory across all its
-- normal chats. An entry has a kind, a text, a short topic, the time, the chat
-- it comes from (named as it was when the entry was written) and the people of
-- that chat. A confidential chat never writes an entry; the repository also
-- leaves out the entries of a chat that is confidential now.
-- `sequence` orders the entries by insertion and is the position the sessions
-- of the agent remember (logbook_seen); the ring buffer drops the lowest first.
CREATE TABLE agent_logbook_entries (
    id TEXT NOT NULL,
    sequence BIGINT GENERATED ALWAYS AS IDENTITY,
    agent_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    text TEXT NOT NULL,
    topic TEXT NOT NULL,
    source_kind TEXT NOT NULL,
    source_id TEXT NOT NULL,
    source_name TEXT NOT NULL,
    participants TEXT NOT NULL DEFAULT '[]',
    origin TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT utc_now(),
    PRIMARY KEY (id),
    UNIQUE (sequence),
    CHECK (kind IN ('decision', 'open', 'fact', 'question', 'note')),
    CHECK (source_kind IN ('direct', 'group')),
    CHECK (origin IN ('agent', 'background'))
);

CREATE INDEX agent_logbook_entries_agent ON agent_logbook_entries (agent_id, sequence);
CREATE INDEX agent_logbook_entries_source ON agent_logbook_entries (source_kind, source_id);

-- Per agent: the entries after which the oldest drop out, the minutes of quiet
-- until a chat is summarized in the background, the model of that summary (both
-- columns or neither; neither follows the instance) and the moment the
-- compaction was asked for last, so it is not asked again at once.
ALTER TABLE agent_employees
    ADD COLUMN logbook_limit INTEGER NOT NULL DEFAULT 200,
    ADD COLUMN logbook_quiet_minutes INTEGER NOT NULL DEFAULT 2,
    ADD COLUMN logbook_connection_id TEXT,
    ADD COLUMN logbook_model TEXT,
    ADD COLUMN logbook_compaction_at TEXT,
    ADD CONSTRAINT agent_employees_logbook_limit_check
        CHECK (logbook_limit BETWEEN 10 AND 2000),
    ADD CONSTRAINT agent_employees_logbook_quiet_minutes_check
        CHECK (logbook_quiet_minutes BETWEEN 1 AND 240),
    ADD CONSTRAINT agent_employees_logbook_model_check
        CHECK ((logbook_connection_id IS NULL) = (logbook_model IS NULL));

-- The model the instance names for the background summary of agents without one
-- of their own; neither column set means the agent's own model.
ALTER TABLE agent_session_settings
    ADD COLUMN logbook_connection_id TEXT,
    ADD COLUMN logbook_model TEXT,
    ADD CONSTRAINT agent_session_settings_logbook_model_check
        CHECK ((logbook_connection_id IS NULL) = (logbook_model IS NULL));

-- Per chat session: the newest entry the session was told about (logbook_seen,
-- so a round carries a hint line only for newer entries of other chats), the
-- position of the chat up to which the background summary read it
-- (logbook_through; the sequence of a group message, the position in a direct
-- chat) and when that summary last finished (logbook_processed_at). A session is
-- due once it was quiet and a round ended after the last summary.
ALTER TABLE agent_conversations
    ADD COLUMN logbook_seen BIGINT NOT NULL DEFAULT 0,
    ADD COLUMN logbook_through BIGINT NOT NULL DEFAULT 0,
    ADD COLUMN logbook_processed_at TEXT;
