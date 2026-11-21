-- Small sample inventory for the table search_embeddings, for development
-- and checks of indexing and search. It uses three dimensions and neutral
-- example identifiers; real models such as BAAI/bge-m3 have 1024.
-- Load it into a migrated, disposable database, never into a live one:
--     psql "$TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -f docs/SearchEmbeddings.fixture.sql
BEGIN;

DELETE FROM search_embeddings
WHERE model_version IN ('fixture-3d@1', 'fixture-3d@2');

INSERT INTO search_embeddings (
    source_type,
    source_id,
    source_version,
    section_index,
    section_text,
    model_version,
    dimensions,
    embedding
)
VALUES
    ('wiki_page', 'fixture-wiki-backup', '2', 0, 'Backups laufen jeden Tag um 03:30.', 'fixture-3d@1', 3, '{1,0,0}'),
    ('wiki_page', 'fixture-wiki-backup', '2', 1, 'Die Wiederherstellung wird jeden Morgen geprüft.', 'fixture-3d@1', 3, '{0.9,0.3,0}'),
    ('ticket', 'fixture-ticket-login', '2026-11-20 10:00:00', 0, 'Login schlägt nach einem Passwortwechsel fehl.', 'fixture-3d@1', 3, '{0,1,0}'),
    ('ticket', 'fixture-ticket-hidden', '2026-11-20 11:00:00', 0, 'Backup des privaten Projekts.', 'fixture-3d@1', 3, '{1,0.01,0}'),
    ('ticket_asset', 'fixture-asset-log', 'sha256:5f2b', 0, 'Protokoll eines fehlgeschlagenen Logins.', 'fixture-3d@1', 3, '{0,0.6,0.8}'),
    -- The same page in another model version: a separate inventory.
    ('wiki_page', 'fixture-wiki-backup', '2', 0, 'Backups laufen jeden Tag um 03:30.', 'fixture-3d@2', 3, '{0,0,1}');

COMMIT;

-- Exact cosine search over the visible sources, with pgvector activated.
-- fixture-ticket-hidden is closest to the question but not visible, so it
-- takes no place. Expected rows, closest first:
--     wiki_page    fixture-wiki-backup   0  0.0012
--     wiki_page    fixture-wiki-backup   1  0.0367
--     ticket       fixture-ticket-login  0  0.9501
--     ticket_asset fixture-asset-log     0  0.9700
--
--     SELECT
--         section.source_type,
--         section.source_id,
--         section.section_index,
--         round((section.embedding::vector <=> '{1,0.05,0}'::REAL[]::vector)::NUMERIC, 4) AS cosine_distance
--     FROM search_embeddings AS section
--     WHERE section.model_version = 'fixture-3d@1'
--         AND section.dimensions = 3
--         AND (section.source_type, section.source_id) IN (
--             VALUES
--                 ('wiki_page', 'fixture-wiki-backup'),
--                 ('ticket', 'fixture-ticket-login'),
--                 ('ticket_asset', 'fixture-asset-log')
--         )
--     ORDER BY cosine_distance, section.source_type, section.source_id, section.section_index
--     LIMIT 10;
