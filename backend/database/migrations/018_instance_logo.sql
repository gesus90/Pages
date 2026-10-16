-- The company logo of the instance. One row (id = 1) at most; an
-- administrator uploads it in the system settings.
CREATE TABLE instance_logo (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    mime_type TEXT NOT NULL,
    data BLOB NOT NULL,
    updated_at TEXT NOT NULL DEFAULT utc_now()
);
