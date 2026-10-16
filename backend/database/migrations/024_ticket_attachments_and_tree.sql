-- Ticket hierarchy and Jira-like ticket details (A8.2).
--
-- Files attached to tickets, kept like wiki attachments: the bytes lie in
-- the directory ticket-attachments next to the database under a name the
-- server picked; the row keeps the cleaned file name, the detected type and
-- a checksum. Rows vanish with their ticket when it is deleted for good.
CREATE TABLE work_item_attachments (
    id TEXT PRIMARY KEY,
    work_item_id TEXT NOT NULL,
    file_name TEXT NOT NULL,
    content_type TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (
        kind IN ('media', 'file')
    ),
    size BIGINT NOT NULL,
    checksum TEXT NOT NULL,
    storage_name TEXT NOT NULL,
    uploaded_by TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT utc_now()
);

-- Branches of the ticket tree in the sidebar a person opened. A key is a
-- ticket id or a group such as 'project:<id>' or 'no-epic:<project id>'.
CREATE TABLE work_item_tree_expansions (
    user_id TEXT NOT NULL,
    node_key TEXT NOT NULL,
    PRIMARY KEY (user_id, node_key)
);
