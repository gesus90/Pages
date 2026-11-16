CREATE TABLE runner_settings (
    singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
    settings_json TEXT NOT NULL
);

CREATE TABLE runner_maintenance (
    connection_id TEXT PRIMARY KEY,
    requested BOOLEAN NOT NULL DEFAULT FALSE,
    receipt_json TEXT
);
