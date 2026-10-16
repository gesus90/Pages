-- PAGE-27: Discord bot notifications of a project. The Discord application
-- (id, OAuth client secret, bot token) is instance configuration read from the
-- environment and never stored here. Times are UTC text like every other
-- column and are always passed in by the service, never read from the clock.

-- One row per connected project: the verified server, the chosen channel and
-- the independent switches of the four events. Deleting the row is the whole
-- disconnect; the bot stays on the Discord server.
CREATE TABLE project_discord_connections (
    project_id TEXT PRIMARY KEY,
    guild_id TEXT NOT NULL,
    guild_name TEXT NOT NULL,
    channel_id TEXT NOT NULL,
    channel_name TEXT NOT NULL,
    base_url TEXT NOT NULL,
    notify_ticket_created INTEGER NOT NULL DEFAULT 1 CHECK (
        notify_ticket_created IN (0, 1)
    ),
    notify_ticket_updated INTEGER NOT NULL DEFAULT 1 CHECK (
        notify_ticket_updated IN (0, 1)
    ),
    notify_milestone_created INTEGER NOT NULL DEFAULT 1 CHECK (
        notify_milestone_created IN (0, 1)
    ),
    notify_milestone_updated INTEGER NOT NULL DEFAULT 1 CHECK (
        notify_milestone_updated IN (0, 1)
    ),
    connected_by TEXT NOT NULL,
    connected_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

-- A short-lived, single-use connection attempt. It binds the OAuth state to the
-- signed-in Pages user and the project, so the callback may arrive from another
-- device. Only the SHA-256 hash of the state is stored.
CREATE TABLE discord_connection_attempts (
    id TEXT PRIMARY KEY,
    state_hash TEXT NOT NULL UNIQUE,
    project_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    base_url TEXT NOT NULL,
    status TEXT NOT NULL CHECK (
        status IN ('pending', 'authorized', 'failed', 'confirmed', 'cancelled')
    ),
    failure TEXT,
    guild_id TEXT,
    guild_name TEXT,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    consumed_at TEXT
);

CREATE INDEX discord_connection_attempts_owner
    ON discord_connection_attempts (project_id, user_id);

-- The persistent outbox. A row is written after the Pages change committed and
-- is delivered by a worker with a bounded number of attempts. The target
-- channel is read from the connection at delivery time. Changes of one ticket or
-- milestone that arrive while its message still waits are merged into that
-- message; subject_key (the Pages path of the item) tells which item it is about.
CREATE TABLE discord_deliveries (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    subject_key TEXT NOT NULL,
    content_json TEXT NOT NULL,
    status TEXT NOT NULL CHECK (
        status IN ('pending', 'sending', 'sent', 'failed')
    ),
    attempts INTEGER NOT NULL DEFAULT 0,
    next_attempt_at TEXT NOT NULL,
    locked_until TEXT,
    last_problem TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    sent_at TEXT
);

CREATE INDEX discord_deliveries_due
    ON discord_deliveries (status, next_attempt_at);

CREATE INDEX discord_deliveries_project
    ON discord_deliveries (project_id, subject_key);
