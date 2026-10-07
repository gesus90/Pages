CREATE TABLE project_templates (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    status TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT utc_now()
);

CREATE TABLE project_template_goals (
    template_id TEXT NOT NULL,
    position INTEGER NOT NULL,
    title TEXT NOT NULL,
    PRIMARY KEY (template_id, position)
);

CREATE TABLE project_template_tags (
    template_id TEXT NOT NULL,
    tag TEXT NOT NULL,
    PRIMARY KEY (template_id, tag)
);
