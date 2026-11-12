-- PAGE-321: a deletion is reversible for seven days. The account and its
-- private rows stay in place until cleanup, but are inactive and hidden.
CREATE TABLE agent_deletion_previews (
    id TEXT PRIMARY KEY,
    agent_id TEXT NOT NULL,
    actor_id TEXT NOT NULL,
    inventory_hash TEXT NOT NULL,
    expires_at TEXT NOT NULL
);

CREATE INDEX agent_deletion_previews_expiry
    ON agent_deletion_previews (expires_at);

CREATE TABLE agent_deletions (
    agent_id TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    deleted_at TEXT NOT NULL,
    deleted_by TEXT NOT NULL,
    restorable_until TEXT NOT NULL,
    was_active BOOLEAN NOT NULL,
    token_state JSONB NOT NULL,
    assigned_tickets JSONB NOT NULL,
    assigned_tasks JSONB NOT NULL,
    counts JSONB NOT NULL,
    purged_at TEXT
);

ALTER TABLE conversations
    ADD COLUMN deleted_agent_id TEXT;

CREATE INDEX agent_deletions_expiry
    ON agent_deletions (restorable_until)
    WHERE purged_at IS NULL;

CREATE TABLE agent_deletion_events (
    id TEXT PRIMARY KEY,
    agent_id TEXT NOT NULL,
    actor_id TEXT NOT NULL,
    action TEXT NOT NULL CHECK (action IN ('delete', 'restore', 'purge')),
    occurred_at TEXT NOT NULL,
    counts JSONB NOT NULL
);

CREATE TABLE agent_deletion_files (
    kind TEXT NOT NULL CHECK (kind IN ('session', 'chat', 'plan', 'voice')),
    name TEXT NOT NULL,
    PRIMARY KEY (kind, name)
);

CREATE TABLE agent_deletion_operations (
    id TEXT PRIMARY KEY,
    action TEXT NOT NULL CHECK (action IN ('delete', 'restore')),
    agent_id TEXT NOT NULL,
    actor_id TEXT NOT NULL,
    result JSONB NOT NULL
);
