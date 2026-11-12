-- PAGE-314: a ticket belongs to no, one or several departments. The single
-- column work_items.department_id becomes the set work_item_departments. A
-- ticket without a row stays visible to everyone with project access, a ticket
-- with rows is visible to the members of at least one of its departments.
CREATE TABLE work_item_departments (
    work_item_id TEXT NOT NULL,
    department_id TEXT NOT NULL,
    PRIMARY KEY (work_item_id, department_id)
);

CREATE INDEX work_item_departments_by_department
    ON work_item_departments (department_id, work_item_id);

-- Every existing assignment moves over; tickets without a department get no row.
INSERT INTO work_item_departments (work_item_id, department_id)
SELECT
    id,
    department_id
FROM work_items
WHERE department_id IS NOT NULL;

DROP INDEX work_items_department_idx_v085;

ALTER TABLE work_items
    DROP COLUMN department_id;

-- The audience of a deleted ticket names all of its departments, as a JSON list.
ALTER TABLE pages_event_outbox
    ADD COLUMN audience_department_ids TEXT NOT NULL DEFAULT '[]';

UPDATE pages_event_outbox
SET audience_department_ids = json_build_array(audience_department_id)::text
WHERE audience_department_id IS NOT NULL;

ALTER TABLE pages_event_outbox
    DROP CONSTRAINT pages_event_outbox_check;

ALTER TABLE pages_event_outbox
    DROP COLUMN audience_department_id;

ALTER TABLE pages_event_outbox
    ADD CONSTRAINT pages_event_outbox_audience_check
    CHECK (audience_project_id IS NOT NULL OR audience_department_ids = '[]');
