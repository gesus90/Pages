-- PAGE-144: what a read-only probe found on a remote machine after a connect.
--
-- A finding is bound to the host, port, user and pinned host key it was made
-- for; the service reads it only while the connection still has exactly that
-- identity. The observation holds machine facts as stable values (flags, a
-- runner version, tool versions), never SSH output. Pairing and readiness are
-- not stored here: Pages derives them from its own runner registration.
CREATE TABLE remote_install_findings (
    connection_id TEXT PRIMARY KEY,
    host TEXT NOT NULL,
    port INTEGER NOT NULL CHECK (port BETWEEN 1 AND 65535),
    username TEXT NOT NULL,
    host_key_fingerprint TEXT NOT NULL,
    observation_json TEXT NOT NULL,
    observed_at TEXT NOT NULL
);
