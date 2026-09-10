-- Targeted indexes for hot overview queries (verified with
-- EXPLAIN QUERY PLAN against a multi-thousand-row database):
-- milestones were fully scanned per project, and the ever-growing
-- project activity log sorted without index support.
CREATE INDEX IF NOT EXISTS idx_milestones_project
    ON milestones (project_id);

CREATE INDEX IF NOT EXISTS idx_project_activity_project_created
    ON project_activity (project_id, created_at);
