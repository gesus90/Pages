-- What the local search indexer last embedded of each source, per model
-- version. The indexer compares the fingerprint of the current text with the
-- stored one, embeds only new and changed sources and removes sources that
-- no longer exist. A source whose text yields no section, such as a released
-- asset that is no UTF-8 text, is recorded with zero sections, so an
-- unchanged source is never read again.
--
-- Each model version keeps its own rows, like search_embeddings: a new model
-- version starts with an empty inventory and indexes every source anew.
CREATE TABLE search_index_sources (
    model_version TEXT NOT NULL,
    source_type TEXT NOT NULL,
    source_id TEXT NOT NULL,
    source_version TEXT NOT NULL,
    fingerprint TEXT NOT NULL,
    section_count INTEGER NOT NULL,
    indexed_at TEXT NOT NULL DEFAULT utc_now(),
    PRIMARY KEY (model_version, source_type, source_id),
    CHECK (source_type IN ('ticket', 'wiki_page', 'ticket_asset')),
    CHECK (char_length(model_version) BETWEEN 1 AND 200),
    CHECK (char_length(source_id) BETWEEN 1 AND 200),
    CHECK (char_length(source_version) BETWEEN 1 AND 200),
    CHECK (char_length(fingerprint) BETWEEN 1 AND 200),
    CHECK (section_count >= 0)
);

-- Removing a source touches its rows in every model version.
CREATE INDEX search_index_sources_source ON search_index_sources (source_type, source_id);

-- Ticket assets whose text a person with the right to change the ticket
-- released for the search. Only these assets are read by the indexer; a
-- withdrawn release or a removed attachment takes the asset out of the
-- search inventory on the next run.
CREATE TABLE ticket_asset_search_releases (
    attachment_id TEXT NOT NULL,
    released_by TEXT NOT NULL,
    released_at TEXT NOT NULL DEFAULT utc_now(),
    PRIMARY KEY (attachment_id),
    FOREIGN KEY (attachment_id) REFERENCES work_item_attachments (id) ON DELETE CASCADE
);
