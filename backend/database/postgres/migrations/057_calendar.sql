-- PAGE-301: the Pages calendar. Events, their recurrence rule, exceptions of
-- single occurrences, invitations (kind and id of the invitee) and responses
-- per person. Instants are stored as UTC ISO text, all-day dates as
-- YYYY-MM-DD without a time zone; `time_zone` is the zone of the creator in
-- which a recurrence is computed.
CREATE TABLE calendar_events (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
    description TEXT NOT NULL DEFAULT '' CHECK (char_length(description) <= 10000),
    is_all_day BOOLEAN NOT NULL DEFAULT FALSE,
    start_at TEXT NOT NULL,
    end_at TEXT NOT NULL,
    time_zone TEXT NOT NULL,
    project_id TEXT,
    created_by TEXT NOT NULL,
    revision BIGINT NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT utc_now(),
    updated_at TEXT NOT NULL DEFAULT utc_now(),
    deleted_at TEXT
);
CREATE INDEX calendar_events_creator ON calendar_events (created_by) WHERE deleted_at IS NULL;
CREATE INDEX calendar_events_project ON calendar_events (project_id) WHERE deleted_at IS NULL;

CREATE TABLE calendar_event_recurrences (
    event_id TEXT PRIMARY KEY REFERENCES calendar_events (id) ON DELETE CASCADE,
    frequency TEXT NOT NULL CHECK (frequency IN ('daily', 'weekly', 'monthly', 'yearly')),
    "interval" INTEGER NOT NULL CHECK ("interval" BETWEEN 1 AND 99),
    weekdays TEXT NOT NULL DEFAULT '[]',
    until_date TEXT,
    occurrence_count INTEGER CHECK (occurrence_count BETWEEN 1 AND 999),
    CHECK (until_date IS NULL OR occurrence_count IS NULL)
);

CREATE TABLE calendar_event_exceptions (
    event_id TEXT NOT NULL REFERENCES calendar_events (id) ON DELETE CASCADE,
    occurrence_start TEXT NOT NULL,
    is_cancelled BOOLEAN NOT NULL DEFAULT FALSE,
    title TEXT CHECK (title IS NULL OR char_length(title) BETWEEN 1 AND 200),
    description TEXT CHECK (description IS NULL OR char_length(description) <= 10000),
    is_all_day BOOLEAN,
    start_at TEXT,
    end_at TEXT,
    updated_at TEXT NOT NULL DEFAULT utc_now(),
    PRIMARY KEY (event_id, occurrence_start)
);

CREATE TABLE calendar_event_invitations (
    event_id TEXT NOT NULL REFERENCES calendar_events (id) ON DELETE CASCADE,
    invitee_kind TEXT NOT NULL CHECK (invitee_kind IN ('person', 'agent', 'group', 'department')),
    invitee_id TEXT NOT NULL,
    position INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (event_id, invitee_kind, invitee_id)
);
CREATE INDEX calendar_event_invitations_invitee ON calendar_event_invitations (invitee_kind, invitee_id);

CREATE TABLE calendar_event_responses (
    event_id TEXT NOT NULL REFERENCES calendar_events (id) ON DELETE CASCADE,
    user_id TEXT NOT NULL,
    response TEXT NOT NULL CHECK (response IN ('accepted', 'declined')),
    updated_at TEXT NOT NULL DEFAULT utc_now(),
    PRIMARY KEY (event_id, user_id)
);

-- Stored answers of calendar changes by operation ID, for the MCP interface.
CREATE TABLE calendar_operations (
    account_id TEXT NOT NULL,
    operation_id TEXT NOT NULL,
    request_digest TEXT NOT NULL,
    response TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT utc_now(),
    PRIMARY KEY (account_id, operation_id)
);

ALTER TABLE user_settings
    ADD COLUMN notify_calendar_invitations INTEGER CHECK (notify_calendar_invitations IN (0, 1));
