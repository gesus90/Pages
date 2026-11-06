-- Committed Pages events, written in the transaction of the change they announce.
-- A row names the kind and the object, never content; the audience of a deleted
-- ticket is its project and department, because the row no longer answers that.
CREATE TABLE pages_event_outbox (
    position BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    kind TEXT NOT NULL CHECK (kind ~ '^[a-z]+(\.[a-z]+)+$'),
    object_id TEXT NOT NULL CHECK (char_length(object_id) BETWEEN 1 AND 200),
    audience_project_id TEXT,
    audience_department_id TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    CHECK (audience_project_id IS NOT NULL OR audience_department_id IS NULL)
);

CREATE INDEX pages_event_outbox_created
    ON pages_event_outbox (created_at, position);

-- A statement trigger runs before the identity default draws a position. Holding
-- the lock until the end of the transaction makes positions visible in commit
-- order, so a reader that stored the highest position it saw never skips a row
-- committed later. A rolled back insert leaves a numeric gap and nothing else.
CREATE FUNCTION lock_pages_event_outbox() RETURNS TRIGGER AS $$
BEGIN
    PERFORM pg_advisory_xact_lock(1346455365, 236);
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER pages_event_outbox_commit_order
BEFORE INSERT ON pages_event_outbox
FOR EACH STATEMENT EXECUTE FUNCTION lock_pages_event_outbox();

-- The stored position of every reader; retention keeps everything after the lowest.
CREATE TABLE pages_event_outbox_readers (
    reader TEXT PRIMARY KEY CHECK (reader ~ '^[a-z][a-z0-9_.-]{0,63}$'),
    position BIGINT NOT NULL CHECK (position >= 0),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

-- The highest position retention removed; no row means nothing was removed yet.
-- A reader whose stored position lies below it may have missed events and has
-- to read the current state again.
CREATE TABLE pages_event_outbox_floor (
    is_single BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (is_single),
    pruned_through BIGINT NOT NULL CHECK (pruned_through > 0)
);
