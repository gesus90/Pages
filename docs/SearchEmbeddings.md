# Search embeddings and pgvector

Pages stores embedding vectors of ticket, wiki and ticket asset text sections in
PostgreSQL. The vector search uses the PostgreSQL extension
[pgvector](https://github.com/pgvector/pgvector). The extension is optional: the
schema, the migration, backups and the existing keyword search work without it.
Only the vector search needs it, and it reports when it is not available so
that the caller keeps to the keyword search.

Sources: [migration](../backend/database/postgres/migrations/080_search_embeddings.sql),
[repository](../backend/database/repositories/search/SearchEmbeddingRepository.ts)
and [sample data](SearchEmbeddings.fixture.sql).

## Schema

`080_search_embeddings.sql` creates the table `search_embeddings`. One row is one
section of one source version, embedded by one model version.

| Column           | Type      | Meaning                                                                      |
| ---------------- | --------- | ---------------------------------------------------------------------------- |
| `source_type`    | `TEXT`    | `ticket`, `wiki_page` or `ticket_asset`.                                     |
| `source_id`      | `TEXT`    | Immutable identifier of the source (ticket, wiki page or asset UUID).        |
| `source_version` | `TEXT`    | Revision the section text was read from, for example the wiki `revision`.    |
| `section_index`  | `INTEGER` | Position of the section in the source, from 0.                               |
| `section_text`   | `TEXT`    | Text of the section, handed to the reader with the source link.              |
| `model_version`  | `TEXT`    | Model and revision that made the vector, for example `BAAI/bge-m3@<commit>`. |
| `dimensions`     | `INTEGER` | Number of vector components, 1 to 16000.                                     |
| `embedding`      | `REAL[]`  | The vector.                                                                  |
| `created_at`     | `TEXT`    | Time of the write, UTC.                                                      |

The primary key is `(model_version, source_type, source_id, section_index)`.
Each model version is a separate inventory: after a model change the sources
are indexed anew next to the old vectors, and a question is compared only with
vectors of the model version that embedded it. An index on
`(source_type, source_id)` serves replacing and removing a source.

Check constraints refuse a vector whose length differs from `dimensions`, a
nested array, `NULL`, `NaN` and infinite components and the zero vector, whose
cosine distance is undefined. One such row would otherwise break every search.

The vector is a `REAL` array and not the pgvector type `vector`. That keeps the
migration runnable on every instance, also where the extension is not installed,
and keeps the data independent of the extension: deactivating it removes no row,
and a dump restores on a server without it. With the extension activated, the
search casts the array to `vector`.

## Repository

`SearchEmbeddingRepository` owns the table:

- `readVectorSupport()` tells whether the server offers pgvector
  (`isAvailable`) and whether it is activated in this database (`isInstalled`,
  `installedVersion`).
- `replaceSourceSections(source, modelVersion, sections)` replaces every
  section of a source for one model version in one transaction. Sections of an
  older source version and sections beyond the new count disappear, so a
  repeated run leaves no duplicates. An empty list removes the source from that
  model's inventory. Invalid vectors raise `InvalidEmbeddingError`.
- `removeSource(sourceType, sourceId)` removes a deleted source from every model
  version, together with its index records.
- `replaceIndexedSource(record, sections)`, `listIndexedSources(modelVersion)`,
  `listStoredSourceKeys()` and `removeModelInventory(modelVersion)` serve the
  [local search indexer](SearchIndexing.md), which records version, fingerprint
  and section count of every indexed source in `search_index_sources`.
- `searchExact(request)` returns the nearest sections by exact cosine distance
  (`<=>`, 0 for the same direction up to 2 for the opposite), closest first,
  with source, version, section and distance. It needs the extension and
  otherwise raises `VectorSearchUnavailableError`, also when the extension is
  dropped while a search runs.

`searchExact` takes a `visibleSources` query, which returns the
`(source_type, source_id)` pairs the reader may see. It is applied in the
`WHERE` clause, before ranking and limit, so a hidden section never takes a
place among the hits. The existing visibility logic fits directly, for example
for wiki pages:

```ts
const visible = createVisiblePagesQuery(scope);
const hits = await repository.searchExact({
  modelVersion,
  embedding,
  limit: 10,
  visibleSources: {
    sql: `${visible.sql} SELECT 'wiki_page', visible_pages.id FROM visible_pages`,
    parameters: visible.parameters,
  },
});
```

The visibility query must not use the placeholder names `model_version`,
`dimensions`, `query_embedding` and `limit`; the repository refuses a
collision instead of replacing a value.

The search is exact: it compares every section of the model version that the
visible sources hold, with a sequential scan. It also stays exact when an
approximate index is added later, because it orders by the distance to the
uncast `vector` together with tie-breakers, which an index on
`embedding::vector(<n>)` does not serve.

## Activation and deactivation

pgvector is not a trusted extension. Only a superuser activates it, and the
server needs the package of its major version, on Debian and Ubuntu
`postgresql-18-pgvector`. The role of `databaseUrl` cannot activate it
(`permission denied to create extension "vector"`).

Activate the extension **after** the setup wizard initialized the database. The
wizard refuses a database whose `public` schema holds functions or types, and
pgvector adds both there. As superuser, in the Pages database:

```sql
CREATE EXTENSION IF NOT EXISTS vector;
SELECT extversion FROM pg_extension WHERE extname = 'vector';
```

Pages needs no restart; the next search finds the extension.

To deactivate, as superuser:

```sql
DROP EXTENSION vector;
```

No Pages object depends on the extension, so this needs no `CASCADE` and every
row of `search_embeddings` stays. The vector search then raises
`VectorSearchUnavailableError` and the keyword search continues. Activating the
extension again makes the stored vectors searchable at once, without a new
indexing run. Once an approximate index on `embedding::vector(<n>)` exists,
`DROP EXTENSION vector` refuses; `DROP EXTENSION vector CASCADE` removes only
those indexes and keeps the rows.

## Backup and restore

The table is part of every backup of the Pages database.

**Logical dump.** With the extension activated, `pg_dump` writes the entries
`EXTENSION vector` and `COMMENT ON EXTENSION vector`. The role of `databaseUrl`
cannot restore them: a restore as that role reports `must be owner of extension
vector` (extension already present) or `extension "vector" is not available`
(server without the package). Both entries hold no data. Leave them out and
restore everything else:

```sh
pg_restore -l pages.dump | grep -v -E 'EXTENSION - vector|COMMENT - EXTENSION vector' > pages.list
pg_restore --no-owner --exit-on-error -L pages.list -d <empty-database> pages.dump
```

To keep the vector search, activate the extension as superuser in the target
database before or after this restore. Without it the restored instance has
all vectors and the keyword search, and the vector search reports that it is
unavailable.

**Physical backup.** The base backup and WAL archive of the
[running backup](PostgresMigration.md#running-backup) contain the extension's
catalog entries, not its program library. The server that replays a backup
needs the same `postgresql-18-pgvector` package as the source to run the vector
search. Install it on every recovery host before activating the extension on the
source.

## Isolated test instance

The schema was developed and checked against a disposable container, not
against a live instance. The container runs `pgvector/pgvector:pg18` (PostgreSQL
18.7, pgvector 0.8.7) on a fresh volume and listens on the loopback address
only:

```sh
docker volume create pages-pgvector-check-data
docker run -d --name pages-pgvector-check \
    --env-file <private-env-file-with-POSTGRES_PASSWORD> \
    -e POSTGRES_INITDB_ARGS='--encoding=UTF8 --locale-provider=libc --locale=C.UTF-8' \
    -p 127.0.0.1:56581:5432 \
    -v pages-pgvector-check-data:/var/lib/postgresql \
    pgvector/pgvector:pg18
```

Each check used its own database with the locale of the
[development database](PostgresMigration.md#local-development-database) and a
role `pages_app` without superuser rights, as on a Pages installation. The Pages
code itself (`Database.migrate`, `SearchEmbeddingRepository`,
`WikiSearchRepository`) ran against it:

| Check                           | Result                                                                                                      |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| New installation, no extension  | All 106 migrations applied; writes, constraints and keyword search work; vector search reports unavailable. |
| Activation as `pages_app`       | Refused: superuser required.                                                                                |
| Activation as superuser         | Exact search returns the visible sections in distance order; hidden sources excluded before the limit.      |
| Upgrade from `079`              | Only `080` applied; existing wiki rows unchanged (same checksum); a second start applies nothing.           |
| Deactivation                    | `DROP EXTENSION vector` without `CASCADE`; all rows kept; keyword search works; reactivation searches.      |
| Dump, restore with extension    | Rows identical (row count and MD5 over all columns); migrations verify; vector search works.                |
| Dump, restore without extension | Rows identical; restore exit code 0 with the filtered list; keyword search works.                           |
| Restore on PostgreSQL 18.6      | Same result on a server without the pgvector package.                                                       |

`docker stop pages-pgvector-check` and `docker start pages-pgvector-check`
keep the volume and its databases. To remove the test instance: `docker rm -f pages-pgvector-check` and
`docker volume rm pages-pgvector-check-data`.

## Measurements for an index decision

The first search is exact. These measurements of the container decide later
whether an approximate index is needed. Random vectors with 1024 dimensions, as
made by `BAAI/bge-m3`, four sections per source, all sources visible, 10 hits,
median of five warm runs, 16 cores, `shared_buffers` 128 MB, two parallel
workers:

| Sections | Table with TOAST | Exact search, `REAL[]` cast | Exact search, `vector(1024)` column |
| -------: | ---------------: | --------------------------: | ----------------------------------: |
|    1,000 |           5.8 MB |                       10 ms |                                6 ms |
|   10,000 |            55 MB |                      102 ms |                               58 ms |
|   50,000 |           276 MB |                      578 ms |                              382 ms |

The time grows linearly with the number of compared sections. The cast from
`REAL[]` costs about a third on top of a native `vector` column.

An HNSW index on `(embedding::vector(1024)) vector_cosine_ops` for one model
version, at 50,000 sections: 59 s to build with `maintenance_work_mem` 512 MB,
391 MB on disk, about 1 ms per search with `hnsw.ef_search` 40 and 8 ms with 400.
Its recall@10 against the exact answer was 0.06 and 0.38 on random vectors.
Random high-dimensional vectors are almost equally far from each other, the
worst case for an approximate index, so this recall is no estimate for real
text embeddings; measure it again with real vectors before deciding.

Guidance from these numbers: below about 10,000 visible sections per model
version the exact search stays near 100 ms and needs no index. Beyond that,
measure recall and time with real embeddings. An index is then a partial
expression index per model version, which keeps the column type and the data
independent of the extension.

## Sample data

[`SearchEmbeddings.fixture.sql`](SearchEmbeddings.fixture.sql) holds a small
inventory with three dimensions for disposable databases: two sections of one
wiki page version, a visible and a hidden ticket, a ticket asset and the same
page in a second model version. Its closing comment holds an exact search over
the visible sources and the expected rows.
