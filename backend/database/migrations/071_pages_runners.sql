-- PAGE-141: durable pairing and interruption recovery; only token digests are stored.
CREATE TABLE pages_runners (
    connection_id TEXT PRIMARY KEY,
    runner_id TEXT NOT NULL UNIQUE,
    token_hash TEXT NOT NULL,
    connection_revision INTEGER NOT NULL,
    state_json TEXT NOT NULL,
    registered_at TEXT NOT NULL DEFAULT utc_now()
);

-- Offline deploy-key state is explicitly separate from remotely verified results.
CREATE TABLE runner_deploy_keys (
    project_id TEXT NOT NULL,
    key_id TEXT NOT NULL,
    public_key TEXT NOT NULL,
    title TEXT NOT NULL,
    PRIMARY KEY (project_id, key_id),
    UNIQUE (project_id, public_key)
);
