-- PAGE-305: the memory of agents across chats. MEMORY.md keeps the current
-- topics and is updated after every answer, within a character limit per
-- agent; older and finished topics move into the archive with their source.
-- DREAM.md keeps lessons, maintained by a nightly dream run that replaces
-- the learning rhythm; its time of day is set under Einstellungen → Agents.
-- A chat can be marked confidential: nothing of it is shared or learned.
ALTER TABLE agent_employees
    ADD COLUMN dream TEXT NOT NULL DEFAULT '';

ALTER TABLE agent_employees
    ADD COLUMN memory_characters INTEGER NOT NULL DEFAULT 8000;

ALTER TABLE agent_employees
    ADD COLUMN dream_characters INTEGER NOT NULL DEFAULT 4000;

ALTER TABLE agent_employees
    ADD CONSTRAINT agent_employees_memory_characters_check
    CHECK (memory_characters BETWEEN 1000 AND 100000);

ALTER TABLE agent_employees
    ADD CONSTRAINT agent_employees_dream_characters_check
    CHECK (dream_characters BETWEEN 500 AND 50000);

-- Where an archive entry came from, as JSON: the chat, tickets and wiki pages.
-- Entries of earlier versions have none.
ALTER TABLE agent_memory_archive
    ADD COLUMN source TEXT;

ALTER TABLE agent_memory_versions
    ADD COLUMN dream TEXT NOT NULL DEFAULT '';

ALTER TABLE agent_memory_versions
    DROP CONSTRAINT agent_memory_versions_reason_check;

ALTER TABLE agent_memory_versions
    ADD CONSTRAINT agent_memory_versions_reason_check
    CHECK (reason IN ('initial', 'learning', 'edit', 'restore', 'update', 'dream', 'reset'));

-- A direct chat of a person with an agent marked confidential. The summary
-- of the older part of a chat lives in chat_sessions, as for Pica.
ALTER TABLE agent_conversations
    ADD COLUMN is_confidential BOOLEAN NOT NULL DEFAULT FALSE;

-- The session that summarizes chats and updates MEMORY.md after an answer.
ALTER TABLE agent_conversations
    DROP CONSTRAINT agent_conversations_purpose_check;

ALTER TABLE agent_conversations
    ADD CONSTRAINT agent_conversations_purpose_check
    CHECK (purpose IN ('chat', 'learning', 'conversation', 'memory'));

ALTER TABLE conversations
    ADD COLUMN is_confidential BOOLEAN NOT NULL DEFAULT FALSE;

-- The time of day of the dream run, HH:MM in the time zone of the server.
ALTER TABLE agent_session_settings
    ADD COLUMN dream_time TEXT NOT NULL DEFAULT '03:00';

ALTER TABLE agent_session_settings
    ADD CONSTRAINT agent_session_settings_dream_time_check
    CHECK (dream_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');
