-- Acceptance-criteria checklists and issue links (blocks, relates to,
-- duplicates) for tickets. Links are stored once from the source ticket's
-- perspective; the reciprocal relationship is derived in application code
-- when a ticket looks up its own links.
CREATE TABLE work_item_checklist_items (
    id TEXT PRIMARY KEY,
    work_item_id TEXT NOT NULL REFERENCES work_items (id),
    title TEXT NOT NULL,
    is_done INTEGER NOT NULL DEFAULT 0,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_work_item_checklist_items_work_item
    ON work_item_checklist_items (work_item_id);

CREATE TABLE work_item_links (
    id TEXT PRIMARY KEY,
    work_item_id TEXT NOT NULL REFERENCES work_items (id),
    linked_work_item_id TEXT NOT NULL REFERENCES work_items (id),
    link_type TEXT NOT NULL CHECK (
        link_type IN ('blocks', 'relates_to', 'duplicates')
    ),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (work_item_id, linked_work_item_id, link_type)
);

CREATE INDEX idx_work_item_links_work_item
    ON work_item_links (work_item_id);
CREATE INDEX idx_work_item_links_linked_work_item
    ON work_item_links (linked_work_item_id);
