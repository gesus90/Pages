-- PAGE-300: the speech output (TTS) of the instance, beside the speech
-- recognition of PAGE-273. One row holds the chosen model and the longest
-- output; without a model no agent has a voice. Audio is never stored.
CREATE TABLE speech_synthesis_settings (
    id INTEGER NOT NULL,
    connection_id TEXT,
    model TEXT,
    max_duration_ms INTEGER NOT NULL DEFAULT 120000,
    revision INTEGER NOT NULL DEFAULT 1,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    CHECK (id = 1),
    CHECK ((connection_id IS NULL) = (model IS NULL)),
    CHECK (max_duration_ms IN (30000, 60000, 120000, 180000, 300000, 600000))
);

INSERT INTO speech_synthesis_settings (id) VALUES (1);

-- The voice of an agent: the voice ID of the instance's speech model and the
-- speed in tenths (5 = 0.5x, 20 = 2.0x). Without a voice ID the first voice
-- of the model applies; both stay saved when the model changes.
ALTER TABLE agent_employees
    ADD COLUMN voice_id TEXT;

ALTER TABLE agent_employees
    ADD COLUMN voice_speed_tenths INTEGER NOT NULL DEFAULT 10;

ALTER TABLE agent_employees
    ADD CONSTRAINT agent_employees_voice_speed_check
    CHECK (voice_speed_tenths BETWEEN 5 AND 20);
