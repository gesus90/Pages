-- One system identity. Preserve old profiles and every chat; runtime validates
-- the legacy system selection before activating it, without provider calls.
CREATE TABLE pica_settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    is_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    selection_json TEXT,
    run_json TEXT,
    revision INTEGER NOT NULL DEFAULT 1,
    legacy_checked BOOLEAN NOT NULL DEFAULT FALSE
);

INSERT INTO pica_settings (id) VALUES (1);
