-- Embedding vectors of searchable text sections. One row is one section of
-- one version of a ticket, wiki page or ticket asset, embedded by one model
-- version. Each model version keeps its own inventory, so a model change
-- indexes anew next to the old vectors instead of mixing them.
--
-- The vector is a REAL array and not the pgvector type: the migration runs
-- on every instance, also where the extension is not installed, and a dump
-- restores without it. With pgvector activated, the exact search casts the
-- array to `vector` for the cosine distance; without it, the existing
-- keyword search stays the only search.
CREATE TABLE search_embeddings (
    source_type TEXT NOT NULL,
    source_id TEXT NOT NULL,
    source_version TEXT NOT NULL,
    section_index INTEGER NOT NULL,
    section_text TEXT NOT NULL,
    model_version TEXT NOT NULL,
    dimensions INTEGER NOT NULL,
    embedding REAL[] NOT NULL,
    created_at TEXT NOT NULL DEFAULT utc_now(),
    PRIMARY KEY (model_version, source_type, source_id, section_index),
    CHECK (source_type IN ('ticket', 'wiki_page', 'ticket_asset')),
    CHECK (char_length(source_id) BETWEEN 1 AND 200),
    CHECK (char_length(source_version) BETWEEN 1 AND 200),
    CHECK (char_length(model_version) BETWEEN 1 AND 200),
    CHECK (section_index >= 0),
    -- 16000 is the most dimensions the pgvector type accepts.
    CHECK (dimensions BETWEEN 1 AND 16000),
    CHECK (array_ndims(embedding) = 1),
    CHECK (cardinality(embedding) = dimensions),
    CHECK (array_position(embedding, NULL) IS NULL),
    -- pgvector refuses these values, and one of them would break every search.
    CHECK (NOT ('NaN'::REAL = ANY (embedding))),
    CHECK (NOT ('Infinity'::REAL = ANY (embedding))),
    CHECK (NOT ('-Infinity'::REAL = ANY (embedding))),
    -- A zero vector has no direction, so its cosine distance is undefined.
    CHECK (cardinality(array_remove(embedding, 0::REAL)) > 0)
);

-- Replacing or removing a source touches all of its sections in every model.
CREATE INDEX search_embeddings_source ON search_embeddings (source_type, source_id);
