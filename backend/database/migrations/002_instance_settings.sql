-- Settings of the instance as a whole, written by the setup wizard.
-- The single row (id = 1) names the company and the administrator the
-- latest setup created or updated.
CREATE TABLE instance_settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    company_name TEXT NOT NULL,
    primary_administrator_id TEXT NOT NULL,
    setup_completed_at TEXT NOT NULL DEFAULT utc_now(),
    updated_at TEXT NOT NULL DEFAULT utc_now()
);
