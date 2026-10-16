-- PAGE-19: usage scope of a system-wide connection. 'global' lets every active
-- account use the models offered through the connection; 'restricted' lets only
-- the listed persons and the current members of the listed groups or departments.
CREATE TABLE agent_connection_scopes (
    connection_id TEXT PRIMARY KEY,
    mode TEXT NOT NULL CHECK (mode IN ('global', 'restricted'))
);

CREATE TABLE agent_connection_scope_targets (
    connection_id TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('person', 'group', 'department')),
    target_id TEXT NOT NULL,
    PRIMARY KEY (connection_id, kind, target_id)
);

-- Existing connections keep their system-wide behaviour: neither a silent
-- withdrawal nor a silent extension of who may use them.
INSERT INTO agent_connection_scopes (
    connection_id,
    mode
)
SELECT
    id,
    'global'
FROM agent_connections;
