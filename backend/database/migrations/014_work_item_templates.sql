-- Ticket templates hold the reusable content of a ticket: type, title preset,
-- description, priority, labels and checklist. Assignee, milestone, dates and
-- department are never part of a template. A template is private to its owner
-- until it is shared with everyone, with departments or with projects.
CREATE TABLE work_item_templates (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    owner_id TEXT NOT NULL,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    priority TEXT NOT NULL,
    scope TEXT NOT NULL DEFAULT 'private',
    created_at TEXT NOT NULL DEFAULT utc_now(),
    updated_at TEXT NOT NULL DEFAULT utc_now()
);

CREATE TABLE work_item_template_departments (
    template_id TEXT NOT NULL,
    department_id TEXT NOT NULL,
    PRIMARY KEY (template_id, department_id)
);

CREATE TABLE work_item_template_projects (
    template_id TEXT NOT NULL,
    project_id TEXT NOT NULL,
    PRIMARY KEY (template_id, project_id)
);

CREATE TABLE work_item_template_labels (
    template_id TEXT NOT NULL,
    label_id TEXT NOT NULL,
    PRIMARY KEY (template_id, label_id)
);

CREATE TABLE work_item_template_checklist_items (
    template_id TEXT NOT NULL,
    position INTEGER NOT NULL,
    title TEXT NOT NULL,
    PRIMARY KEY (template_id, position)
);
