-- PAGE-138: SSH connections to remote Linux machines and the workspace
-- profiles registered on them.
--
-- A connection keeps its password, private key and passphrase only as
-- InstanceSecretCipher payloads bound to the connection and the kind of
-- secret; the pinned host key is public. Connections are shared with exactly
-- one department. Remote workspaces are records of their own with a stable
-- identifier, one connection and one project, so local workspaces and the
-- plans that use them stay untouched. The latest test and directory check
-- are kept as stable codes, never as SSH output.
CREATE TABLE remote_connections (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    host TEXT NOT NULL,
    port INTEGER NOT NULL CHECK (port BETWEEN 1 AND 65535),
    username TEXT NOT NULL,
    auth_method TEXT NOT NULL CHECK (
        auth_method IN ('password', 'key', 'key_passphrase')
    ),
    department_id TEXT NOT NULL,
    host_key_algorithm TEXT,
    host_key TEXT,
    host_key_fingerprint TEXT,
    password_encrypted TEXT,
    private_key_encrypted TEXT,
    passphrase_encrypted TEXT,
    checked_at TEXT,
    check_stage TEXT CHECK (
        check_stage IN ('reachability', 'host_key', 'authentication')
    ),
    check_code TEXT,
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT utc_now(),
    updated_by TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT utc_now(),
    revision INTEGER NOT NULL DEFAULT 1,
    CHECK (
        (host_key IS NULL
            AND host_key_algorithm IS NULL
            AND host_key_fingerprint IS NULL)
        OR (host_key IS NOT NULL
            AND host_key_algorithm IS NOT NULL
            AND host_key_fingerprint IS NOT NULL)
    )
);

CREATE UNIQUE INDEX remote_connections_name_lower
    ON remote_connections (lower(name));

CREATE TABLE remote_workspaces (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    connection_id TEXT NOT NULL,
    path TEXT NOT NULL,
    project_id TEXT NOT NULL,
    registered_by TEXT NOT NULL,
    checked_at TEXT,
    check_issue TEXT,
    revision INTEGER NOT NULL DEFAULT 1
);
