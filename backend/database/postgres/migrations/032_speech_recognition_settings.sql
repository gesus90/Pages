-- PAGE-273: the speech recognition (STT) of the instance. One row holds the
-- chosen model and the longest recording; without a model speech recognition
-- is off. Audio is never stored.
CREATE TABLE speech_recognition_settings (
    id INTEGER NOT NULL,
    connection_id TEXT,
    model TEXT,
    max_duration_ms INTEGER NOT NULL DEFAULT 120000,
    revision INTEGER NOT NULL DEFAULT 1,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    CHECK (id = 1),
    CHECK ((connection_id IS NULL) = (model IS NULL)),
    CHECK (max_duration_ms IN (60000, 120000, 300000))
);

INSERT INTO speech_recognition_settings (id) VALUES (1);
