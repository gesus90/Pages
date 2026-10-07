ALTER TABLE work_items ADD COLUMN department_id TEXT;

CREATE INDEX work_items_department_idx ON work_items (department_id, project_id);
