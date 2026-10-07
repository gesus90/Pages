ALTER TABLE project_activity ADD COLUMN work_item_id TEXT;

CREATE INDEX project_activity_work_item_id ON project_activity (work_item_id);
