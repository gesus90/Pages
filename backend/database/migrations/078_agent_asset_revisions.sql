CREATE TABLE agent_asset_revisions (
    source_type TEXT NOT NULL CHECK (source_type IN ('ticket', 'wiki')),
    source_attachment_id TEXT NOT NULL,
    replacement_attachment_id TEXT NOT NULL,
    expected_digest TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT utc_now(),
    PRIMARY KEY (source_type, source_attachment_id),
    UNIQUE (source_type, replacement_attachment_id)
);
