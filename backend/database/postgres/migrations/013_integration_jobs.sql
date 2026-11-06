CREATE TABLE integration_github_jobs (
    id TEXT PRIMARY KEY,
    command_json TEXT NOT NULL,
    deduplication_key TEXT,
    state TEXT NOT NULL DEFAULT 'pending'
        CHECK (state IN ('pending', 'running', 'done', 'failed', 'uncertain')),
    attempts INTEGER NOT NULL DEFAULT 0,
    available_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    result_json TEXT
);

CREATE UNIQUE INDEX integration_github_jobs_active_key
    ON integration_github_jobs (deduplication_key)
    WHERE state IN ('pending', 'running');

CREATE INDEX integration_github_jobs_due
    ON integration_github_jobs (available_at, created_at)
    WHERE state = 'pending';

CREATE TABLE integration_github_creations (
    creation_key TEXT PRIMARY KEY,
    issue_number INTEGER,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
