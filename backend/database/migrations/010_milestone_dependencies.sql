-- Directed dependencies between milestones. Links are stored once from the
-- source milestone's perspective; the reciprocal relationship is derived in
-- application code when a milestone looks up its own links.
CREATE TABLE milestone_dependencies (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects (id),
    source_id TEXT NOT NULL REFERENCES milestones (id),
    target_id TEXT NOT NULL REFERENCES milestones (id),
    link_type TEXT NOT NULL CHECK (
        link_type IN ('prerequisite', 'follows', 'blocks', 'relates_to')
    ),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (source_id, target_id, link_type)
);

CREATE INDEX idx_milestone_dependencies_project
    ON milestone_dependencies (project_id);
CREATE INDEX idx_milestone_dependencies_source
    ON milestone_dependencies (source_id);
CREATE INDEX idx_milestone_dependencies_target
    ON milestone_dependencies (target_id);
