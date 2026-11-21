# RAG and ticket asset acceptance

The acceptance checks the whole flow of ticket assets, the
[local search index](SearchIndexing.md) and the
[hybrid search for agents](HybridSearch.md) together, on synthetic data in a
disposable test environment. It compares the keyword search with the hybrid
search on a fixed German and English question set and checks access
separation, withdrawn rights, archiving, changed sources, upload and download,
the keyword fallback and backup and restore. This page records the procedure,
the results of the acceptance runs and what a later live release still needs.

Sources: [command](../scripts/rag-acceptance.ts),
[synthetic data and question set](../scripts/rag-acceptance/acceptance-data.ts),
[services of a run](../scripts/rag-acceptance/acceptance-context.ts),
[measurement](../scripts/rag-acceptance/search-measurement.ts),
[access, upload and fallback checks](../scripts/rag-acceptance/access-checks.ts),
[change, revocation and archiving checks](../scripts/rag-acceptance/change-checks.ts),
[backup check](../scripts/rag-acceptance/backup-check.ts) and
[disposable instance](../scripts/rag-acceptance/test-instance.ts).

## Test environment

The acceptance never touches a Pages installation, its database or its data
directory. It needs:

| Part             | Used for the recorded runs                                                                                                                                                                |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PostgreSQL       | The disposable container `pages-pgvector-check` of [Search embeddings and pgvector](SearchEmbeddings.md#isolated-test-instance): PostgreSQL 18.7, pgvector 0.8.7, port 56581 on loopback. |
| Superuser access | A private file with the address of a superuser of that container (`--admin-url-file`).                                                                                                    |
| Embedding model  | Text Embeddings Inference 1.8.3 (CPU) with `BAAI/bge-m3` at revision `5617a9f61b028005a4858fdac845db406aefb181`, port 56585 on loopback; the fake `pages/deterministic-word-hash@1-d64`.  |
| Client programs  | `pg_dump` and `pg_restore` 18.6 of the host.                                                                                                                                              |
| Machine          | 16 × Intel Core 5 220H, 22 GB RAM, Node.js 24.22.1, no GPU.                                                                                                                               |

Every run creates its own role `pages_rag_acceptance_<run>` without superuser
rights, as on a Pages installation, with a random password that is never
written down, and its databases `pages_rag_acceptance_<run>_source`, `_restored`
and `_plain`. The superuser only creates and drops them and activates or drops
pgvector. At the end the run drops everything it created, unless `--keep` is
given. Asset files, the dump and the report lie in
`~/.pages/tmp/rag-acceptance/<run>/` (`data/`, `restored-data/`, `backup/`).

The run calls the Pages services in one process, exactly as the server builds
them for an agent call: `search.sources` through `AgentSourceSearchService`
with a verified identity on the MCP channel, uploads and downloads through
`TaskAttachmentService` with the ticket access of the person, ticket changes
and archiving through `TaskService` and `ProjectService`, and the indexer
through `SearchIndexService` like `pnpm run search:index`.

## Synthetic data

All identifiers are fixed, so repeated runs are comparable. The data names no
real person, customer or project.

| Person  | Role                                  | Departments             | Meant to show                                             |
| ------- | ------------------------------------- | ----------------------- | --------------------------------------------------------- |
| `alice` | department-bound, right `write`       | Entwicklung, Sicherheit | Writes in Plattform and sees its tickets of Sicherheit.   |
| `bob`   | department-bound, right `write`       | Vertrieb                | Writes in Vertrieb and sees nothing of Plattform.         |
| `carla` | department-bound, only reading        | Entwicklung             | Reads Plattform, may not upload, does not see Sicherheit. |
| `admin` | administrator (`role-administration`) | none                    | Archives tickets and projects.                            |

- **Projects:** Plattform (department Entwicklung) and Vertrieb (department
  Vertrieb).
- **Tickets:** `RAG-1` to `RAG-8` in Plattform, in German and English;
  `RAG-3` carries the department Sicherheit. `VK-1` to `VK-3` in Vertrieb;
  `VK-3` nearly repeats `RAG-1`, to show that Bob gets his own ticket and not
  the one of Plattform.
- **Wiki pages:** two instance pages (`Anmeldung und Sitzungen`,
  `Release checklist`) and one project page per project.
- **Assets,** uploaded through the attachment service and released by the
  uploader: `refresh-trace.log` (RAG-1), `restore-protokoll.txt` (RAG-4),
  `kundenmail.txt` (VK-1) and the image `board-dark.png` (RAG-7), which is
  recorded without sections. `upload-ausnahmen.txt` (RAG-5) is never released.
- **Question set:** 24 questions, 12 German and 12 English, each with a reader,
  the expected sources and further relevant sources. Forms: 5 literal
  (every word occurs in the source), 10 rephrased, 5 across languages (a
  German question for an English source and the other way round), 2 ticket
  numbers and 2 questions answered only by an asset.

## What a run does

1. Create the role and the source database, apply all migrations as the role,
   activate pgvector as superuser.
2. Write the synthetic data, upload the assets and release them.
3. Index twice; the second run must embed nothing.
4. Ask every question once untimed and then `--repetitions` times timed, in
   both modes: **keyword** (no model, the keyword search and exact ticket
   numbers alone) and **hybrid** (keyword and vector search). Every link of the
   first answer is resolved for its reader.
5. Run the checks of the areas below, in this order: access separation,
   upload and download, fallback, changed sources, withdrawn rights, backup and
   restore, archiving.
6. Write `rag-acceptance-report.json` and `rag-acceptance-report.md`, print a
   summary and exit with 0 when every check held, otherwise 1.

### Figures

| Figure      | Meaning                                                                                                           |
| ----------- | ----------------------------------------------------------------------------------------------------------------- |
| Top-5 hits  | Questions with an expected source among the first five sections, of all questions of the set.                     |
| MRR         | Mean of `1 / rank` of the first expected source, 0 when it is not among the first five.                           |
| Precision@5 | Share of the first five sections whose source is expected or relevant, averaged over the questions.               |
| Latency     | Duration of `search.sources` with resolution of the rights, p50 and p95 by nearest rank over all timed runs.      |
| Valid links | Sections of the first answers whose link opens the source for the reader in the handed-over revision (see below). |

A link is valid when a ticket link opens the ticket for the reader with the
same text hash, an asset link downloads for the reader with the handed-over
SHA-256, and a page link names a page in the handed-over revision.

## Results

Two complete runs on 2026-11-21 with 5 timed repetitions per question, so 120
latency samples per mode; 24 questions decide the hit rates. Both runs passed
all 44 checks.

### `BAAI/bge-m3`

| Mode    | Top-5 hits    | German        | English       | MRR   | Precision@5 | p50 ms | p95 ms | Samples | Valid links |
| ------- | ------------- | ------------- | ------------- | ----- | ----------- | -----: | -----: | ------: | ----------- |
| keyword | 8/24 (33 %)   | 4/12 (33 %)   | 4/12 (33 %)   | 0.333 | 33 %        |   11.6 |   18.6 |     120 | 9/9         |
| hybrid  | 24/24 (100 %) | 12/12 (100 %) | 12/12 (100 %) | 0.958 | 40 %        |  114.5 |  176.6 |     120 | 120/120     |

| Form            | keyword | hybrid |
| --------------- | ------- | ------ |
| literal         | 5/5     | 5/5    |
| rephrased       | 1/10    | 10/10  |
| across language | 0/5     | 5/5    |
| ticket number   | 2/2     | 2/2    |
| asset           | 0/2     | 2/2    |

The expected source was first in 22 questions and second in two (`q09` and
`q11`, where the asset `restore-protokoll.txt` and `kundenmail.txt`, also
relevant, came first).

### Fake model `pages/deterministic-word-hash@1-d64`

| Mode    | Top-5 hits   | German      | English      | MRR   | Precision@5 | p50 ms | p95 ms | Samples | Valid links |
| ------- | ------------ | ----------- | ------------ | ----- | ----------- | -----: | -----: | ------: | ----------- |
| keyword | 8/24 (33 %)  | 4/12 (33 %) | 4/12 (33 %)  | 0.333 | 33 %        |   11.2 |   17.2 |     120 | 9/9         |
| hybrid  | 19/24 (79 %) | 9/12 (75 %) | 10/12 (83 %) | 0.630 | 27 %        |   22.5 |   28.1 |     120 | 120/120     |

The fake understands no meaning; it finds rephrased questions through shared
words and only one of five questions across languages. It shows the flow, not
the quality of a model.

### Checks

| Area              | Checks | What held                                                                                                                                                                                                                                                                                                                                                                       |
| ----------------- | -----: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Indexing          |      1 | 19 sources and 21 sections indexed; the second run embedded nothing; the PNG asset was recorded without sections.                                                                                                                                                                                                                                                               |
| Source links      |      2 | Every link of both modes resolved for its reader to the handed-over revision.                                                                                                                                                                                                                                                                                                   |
| Access separation |      6 | Bob got no section of Plattform, also not by ticket number or through the vector search, but his own `VK-3`; Carla got neither `RAG-3` nor its number; a project limit outside the reader's projects answered `NOT_FOUND`; the never released asset never appeared.                                                                                                             |
| Upload, download  |     11 | Every asset downloaded with the uploaded bytes and stored SHA-256; Carla downloaded but could not upload; Bob could neither download nor upload in Plattform; an upload shorter than announced was refused; refused uploads left no row and no file.                                                                                                                            |
| Fallback          |      7 | No model, an unreachable model, a model slower than 5 s and dropped pgvector each named their reason while the keyword search still found `RAG-1`; reactivated pgvector searched again without indexing; a model version without inventory gave no vector hit; a new ticket without embeddings was found by the keyword search and after the next run by the vector search too. |
| Changed sources   |      4 | Before indexing, the outdated vectors of a changed ticket and a changed page were left out and counted in `staleSections`, and the keyword search handed over the current text; after indexing both were embedded anew; a removed asset disappeared at once and from the index on the next run.                                                                                 |
| Withdrawn rights  |      5 | A removed department membership hid every source of Plattform from the very next search and blocked the download; restoring it showed them again; removing Sicherheit hid `RAG-3` at once; a department added to a ticket hid it from Carla at once; a withdrawn asset release hid the asset at once and the next run removed its sections.                                     |
| Backup, restore   |      6 | After dump and restore with the filtered list, migrations verified, eight tables had the same rows (count and MD5), all 48 answers of both modes were identical, assets downloaded with their SHA-256 from the copied data directory and the indexer embedded nothing; a restore without pgvector kept every vector row and fell back to the keyword search.                    |
| Archiving         |      2 | An archived ticket and its released asset left the search at once, also by ticket number; an archived project took its tickets and project page out of the search at once.                                                                                                                                                                                                      |

Dump of the source database: about 0.9 MB in 0.2 s; restore with activation of
pgvector: about 2.3 s.

### Observations

- **Keyword search.** Every word of the question must occur, so it answers
  literal questions and ticket numbers and fails rephrased and cross-language
  questions. It never searches asset text.
- **Hybrid search.** With `bge-m3` every question found its source among the
  first five, in both languages and across them.
- **Source quality.** No link was invalid and no section was outdated. The
  search always fills the limit: after the relevant sources follow unrelated
  ones by reciprocal rank fusion, which keeps the precision at 40 % with five
  sections (most questions have one to three relevant sources, of at most two
  sections each). Agents must judge the relevance of the later sections.
- **Latency.** The hybrid p95 of 177 ms is mostly the embedding of the question
  on the CPU; the keyword search alone has a p50 of 12 ms and a p95 of 19 ms. A hanging model costs the
  full timeout of 5 seconds before the keyword search answers.
- **Embedding server memory.** With the default batch settings the CPU
  container was killed (exit code 137) while warming up the model;
  `--max-batch-tokens 2048` with an 8 GB memory limit ran without problems.

## Repeat the acceptance

1. Start the disposable PostgreSQL container
   (`docker start pages-pgvector-check`, or create it as in
   [Search embeddings and pgvector](SearchEmbeddings.md#isolated-test-instance)).
   Never use an instance with real data.
2. Create a superuser for the acceptance once and write its address to a
   private file, without the password in an argument or the history:

   ```sh
   umask 077
   password=$(openssl rand -hex 24)
   printf "CREATE ROLE rag_acceptance_admin LOGIN SUPERUSER PASSWORD '%s';\n" "$password" \
       | docker exec -i pages-pgvector-check psql -U postgres -q -v ON_ERROR_STOP=1
   mkdir -p ~/.pages/tmp/rag-acceptance
   printf 'postgresql://rag_acceptance_admin:%s@127.0.0.1:56581/postgres\n' "$password" \
       > ~/.pages/tmp/rag-acceptance/admin-url
   unset password
   ```

3. Start the embedding server on loopback with the pinned revision:

   ```sh
   docker volume create pages-rag-acceptance-models
   docker run -d --name pages-rag-acceptance-tei --memory 8g \
       -p 127.0.0.1:56585:80 -v pages-rag-acceptance-models:/data \
       ghcr.io/huggingface/text-embeddings-inference:cpu-1.8 \
       --model-id BAAI/bge-m3 --revision 5617a9f61b028005a4858fdac845db406aefb181 \
       --max-batch-tokens 2048 --max-client-batch-size 16 --auto-truncate
   curl -s http://127.0.0.1:56585/info
   ```

   The first start downloads about 2.3 GB of model weights into the volume.

4. Run the acceptance with the real model and with the fake:

   ```sh
   pnpm run rag:acceptance --admin-url-file ~/.pages/tmp/rag-acceptance/admin-url \
       --model local --embedding-url http://127.0.0.1:56585 \
       --model-revision 5617a9f61b028005a4858fdac845db406aefb181 --repetitions 5
   pnpm run rag:acceptance --admin-url-file ~/.pages/tmp/rag-acceptance/admin-url \
       --model fake --repetitions 5
   ```

   When `tsx` cannot open its control socket because the temporary directory
   path is too long (`listen EINVAL … .pipe`), run
   `node --import tsx scripts/rag-acceptance.ts` with the same options.

5. Read `rag-acceptance-report.md` in the printed directory. Exit code 0 means
   every check held; the failed checks are printed with what was observed.
   Compare hit rates and latencies with the tables above; the figures of the
   fake model are deterministic, the latencies depend on the machine.

`--output <directory>` writes the report elsewhere, `--keep` keeps the role and
databases of the run for inspection.

## Restore the test environment

- **Leftovers of an aborted or kept run.** As superuser of the container, drop
  every database and the role of the run; nothing else carries the prefix:

  ```sql
  SELECT format('DROP DATABASE %I WITH (FORCE);', datname)
  FROM pg_database WHERE datname LIKE 'pages\_rag\_acceptance\_%';
  -- run the statements it lists, then:
  SELECT format('DROP ROLE %I;', rolname)
  FROM pg_roles WHERE rolname LIKE 'pages\_rag\_acceptance\_%';
  ```

- **Restore a run's backup by hand.** `backup/pages.dump` and
  `backup/pages.list` of a run directory hold the dump and the filtered table
  of contents. Restore into an empty database owned by a role without
  superuser rights, then activate pgvector as superuser, as
  [Search embeddings and pgvector](SearchEmbeddings.md#backup-and-restore)
  describes:

  ```sh
  pg_restore --no-owner --exit-on-error -L backup/pages.list -d <empty-database> backup/pages.dump
  ```

  The asset files belong next to it: `restored-data/assets/` of the same run.

- **Containers.** `docker stop pages-rag-acceptance-tei` frees the memory of
  the model; `docker start` resumes it from the volume. To remove the
  environment: `docker rm -f pages-rag-acceptance-tei`,
  `docker volume rm pages-rag-acceptance-models`, and for the database
  container the commands in
  [Search embeddings and pgvector](SearchEmbeddings.md#isolated-test-instance).
  Remove old run directories below `~/.pages/tmp/rag-acceptance/` when they
  are no longer needed; they hold only synthetic data.

## Prerequisites for a live release

The acceptance covers the services and the database. Before the search is
switched on for a live installation:

1. **pgvector.** Install `postgresql-18-pgvector` on the live server and on
   every recovery host of the physical backup, and activate it as superuser
   after the setup wizard ([activation](SearchEmbeddings.md#activation-and-deactivation)).
2. **Embedding server.** Run Text Embeddings Inference with `BAAI/bge-m3` at a
   pinned revision as a service on the loopback address only, with a memory
   limit and the batch settings above, and start it before the indexer.
3. **Server configuration.** Set `PAGES_SEARCH_EMBEDDING=local`,
   `PAGES_SEARCH_EMBEDDING_URL` and `PAGES_SEARCH_EMBEDDING_REVISION` to the
   same model and revision as the indexer ([configuration](HybridSearch.md#configuration)).
4. **Indexer.** Run `pnpm run search:index <config.toml> --model local … --interval <seconds>`
   as a service and measure the first full run on the live volume; this
   acceptance indexed only 19 sources.
5. **Volume and latency.** Count the sections per model version after the
   first run. Below about 10,000 the exact search stays near 100 ms
   ([measurements](SearchEmbeddings.md#measurements-for-an-index-decision));
   above, decide on an approximate index with real vectors. Repeat the latency
   measurement on the live machine.
6. **Question set from practice.** Repeat the comparison with questions people
   actually ask, with sources checked by a person, before relying on the hit
   rate of this synthetic set.
7. **Backup and restore.** Add the filtered logical restore to the restore
   procedure, and keep the asset directory in the same backup as the database;
   the vectors need no new indexing after a restore.
8. **Rights through the interface.** This acceptance withdrew rights directly
   in the database and called the search and download without a cache, as the
   agent operation does. Check once in the test environment that withdrawing a
   department, a ticket department or a project in the administration and the
   ticket view takes effect as quickly through the web interface and the MCP
   transport.
9. **Asset releases.** Tell the teams that only assets released in the
   attachment list are searched, and that a withdrawn release hides an asset at
   once and removes it from the index on the next run.
10. **Monitoring.** Watch the log events `search.vector_unavailable` and
    `search.embedding_configuration_invalid`; each means the keyword search
    answers alone.
11. **Relevance of later sections.** Decide whether agents get all sections up
    to the limit or only those above a relevance threshold; the precision of
    40 % shows that later sections are often unrelated.
