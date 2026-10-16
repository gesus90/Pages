-- Registrations contain references only; external directory contents are never owned by Pages.
CREATE TABLE agent_workspaces (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    path TEXT NOT NULL UNIQUE,
    directory_identity TEXT NOT NULL,
    project_id TEXT NOT NULL,
    registered_by TEXT NOT NULL,
    revision INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE agent_workspace_targets (
    workspace_id TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('person', 'group', 'department')),
    target_id TEXT NOT NULL,
    PRIMARY KEY (workspace_id, kind, target_id)
);
