-- Monotonic checklist revisions (PAGE-47). The revision of a ticket checklist
-- grows with every change through the agent API and with every content change
-- the API observes, so an update based on an older read is refused even when a
-- change through the API returned the checklist to the same content.
CREATE TABLE work_item_checklist_revisions (
    work_item_id TEXT PRIMARY KEY,
    revision BIGINT NOT NULL,
    content_hash TEXT NOT NULL
);
