ALTER TABLE projects ADD COLUMN parent_id TEXT REFERENCES projects (id);
ALTER TABLE projects ADD COLUMN status TEXT NOT NULL DEFAULT 'planned' CHECK (
    status IN ('planned', 'active', 'paused', 'completed')
);
ALTER TABLE projects ADD COLUMN progress INTEGER NOT NULL DEFAULT 0 CHECK (
    progress BETWEEN 0 AND 100
);
ALTER TABLE projects ADD COLUMN placeholder_color TEXT NOT NULL DEFAULT '#FCE3D3';
ALTER TABLE projects ADD COLUMN archived_at TEXT;

CREATE TABLE project_icons (
    project_id TEXT PRIMARY KEY REFERENCES projects (id),
    mime_type TEXT NOT NULL,
    filename TEXT NOT NULL,
    data BLOB NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
