-- Rows of one second keep the order they were created in. It used to rest on the
-- physical order of the rows, which only DuckDB keeps, and their identifiers are
-- random. Existing rows take it from that physical order and lie before all new ones.
CREATE SEQUENCE row_creation_order START 1;

ALTER TABLE work_item_history ADD COLUMN creation_order BIGINT;
UPDATE work_item_history
SET creation_order = rowid - (SELECT MAX(rowid) + 1 FROM work_item_history);
ALTER TABLE work_item_history ALTER COLUMN creation_order SET DEFAULT nextval('row_creation_order');

ALTER TABLE work_item_links ADD COLUMN creation_order BIGINT;
UPDATE work_item_links
SET creation_order = rowid - (SELECT MAX(rowid) + 1 FROM work_item_links);
ALTER TABLE work_item_links ALTER COLUMN creation_order SET DEFAULT nextval('row_creation_order');

ALTER TABLE work_item_checklist_items ADD COLUMN creation_order BIGINT;
UPDATE work_item_checklist_items
SET creation_order = rowid - (SELECT MAX(rowid) + 1 FROM work_item_checklist_items);
ALTER TABLE work_item_checklist_items ALTER COLUMN creation_order SET DEFAULT nextval('row_creation_order');

ALTER TABLE milestones ADD COLUMN creation_order BIGINT;
UPDATE milestones
SET creation_order = rowid - (SELECT MAX(rowid) + 1 FROM milestones);
ALTER TABLE milestones ALTER COLUMN creation_order SET DEFAULT nextval('row_creation_order');

ALTER TABLE milestone_dependencies ADD COLUMN creation_order BIGINT;
UPDATE milestone_dependencies
SET creation_order = rowid - (SELECT MAX(rowid) + 1 FROM milestone_dependencies);
ALTER TABLE milestone_dependencies ALTER COLUMN creation_order SET DEFAULT nextval('row_creation_order');

ALTER TABLE wiki_comments ADD COLUMN creation_order BIGINT;
UPDATE wiki_comments
SET creation_order = rowid - (SELECT MAX(rowid) + 1 FROM wiki_comments);
ALTER TABLE wiki_comments ALTER COLUMN creation_order SET DEFAULT nextval('row_creation_order');

ALTER TABLE wiki_page_versions ADD COLUMN creation_order BIGINT;
UPDATE wiki_page_versions
SET creation_order = rowid - (SELECT MAX(rowid) + 1 FROM wiki_page_versions);
ALTER TABLE wiki_page_versions ALTER COLUMN creation_order SET DEFAULT nextval('row_creation_order');
