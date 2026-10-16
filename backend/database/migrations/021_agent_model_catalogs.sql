-- A7: administrative, token-free model catalogs and restart-safe refresh cadence.
CREATE TABLE agent_model_catalogs (
    connection_id TEXT PRIMARY KEY,
    interval_hours INTEGER NOT NULL DEFAULT 0 CHECK (interval_hours IN (0, 6, 24, 168)),
    next_refresh_at TEXT,
    attempted_at TEXT,
    refreshed_at TEXT,
    error_code TEXT,
    models_json TEXT NOT NULL DEFAULT '[]'
);
