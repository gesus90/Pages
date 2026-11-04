-- Rows of one second keep the order they were created in (DuckDB migration 090).
-- A fresh database has no such rows, and db:transfer copies the values and the sequence.
CREATE SEQUENCE row_creation_order START 1;

ALTER TABLE work_item_history ADD COLUMN creation_order BIGINT DEFAULT nextval('row_creation_order');
ALTER TABLE work_item_links ADD COLUMN creation_order BIGINT DEFAULT nextval('row_creation_order');
ALTER TABLE work_item_checklist_items ADD COLUMN creation_order BIGINT DEFAULT nextval('row_creation_order');
ALTER TABLE milestones ADD COLUMN creation_order BIGINT DEFAULT nextval('row_creation_order');
ALTER TABLE milestone_dependencies ADD COLUMN creation_order BIGINT DEFAULT nextval('row_creation_order');
ALTER TABLE wiki_comments ADD COLUMN creation_order BIGINT DEFAULT nextval('row_creation_order');
ALTER TABLE wiki_page_versions ADD COLUMN creation_order BIGINT DEFAULT nextval('row_creation_order');
