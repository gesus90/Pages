# Local search indexing

A local worker cuts tickets, wiki pages and released text assets of tickets into
sections, embeds every section on this machine and stores the vectors with
source, source version, section and model version in the table
`search_embeddings` (see [Search embeddings and pgvector](SearchEmbeddings.md)).
No text leaves the machine: the worker accepts only an embedding server on the
loopback address.

Sources: [worker command](../scripts/search-index.ts),
[indexer](../backend/service/search/SearchIndexService.ts),
[embedding models](../backend/service/search/EmbeddingModels.ts),
[source reads](../backend/database/repositories/search/SearchSourceRepository.ts),
[migration](../backend/database/postgres/migrations/082_search_index_sources.sql)
and [sample data](SearchIndexing.fixture.json).

## Running the worker

The worker reads the configuration of a completed setup, connects to its
PostgreSQL database and opens ticket assets in the data directory next to it.
It runs once, or repeatedly with `--interval`, and writes one JSON report per
run. `SIGINT` and `SIGTERM` stop it between runs.

```sh
# Deterministic fake model, for sample data and checks of the flow
pnpm run search:index /absolute/config.toml --model fake

# BAAI/bge-m3 served on this machine, every 300 seconds
pnpm run search:index /absolute/config.toml --model local \
    --embedding-url http://127.0.0.1:8080 --interval 300

# Remove the inventory of an old model version after a model change
pnpm run search:index /absolute/config.toml --model local \
    --embedding-url http://127.0.0.1:8080 --remove-model 'BAAI/bge-m3@<old-revision>'
```

| Option             | Meaning                                                                                   |
| ------------------ | ----------------------------------------------------------------------------------------- |
| `--model`          | `fake` for the deterministic fake, `local` for the local embedding server.                |
| `--dimensions`     | Dimensions of the fake, default 64.                                                       |
| `--embedding-url`  | Root address of the local server; only `127.0.0.1`, `[::1]` and `localhost` are accepted. |
| `--model-id`       | Model the server must run, default `BAAI/bge-m3`.                                         |
| `--model-revision` | Revision the server must run; required when the server reports none.                      |
| `--interval`       | Seconds between runs; without it the worker runs once.                                    |
| `--remove-model`   | Removes the sections and records of that model version and exits.                         |

A report names the model version and counts `indexedSources` (new or changed,
embedded anew), `unchangedSources`, `removedSources`, `writtenSections` and
`skippedAssets` (released assets that are no readable UTF-8 text).

## Models

**Deterministic fake.** `DeterministicEmbeddingModel` adds a signed unit per word
to a component chosen by the SHA-256 of the word and normalizes the vector. Equal
texts get equal vectors, texts sharing words point in similar directions. Its
version is `pages/deterministic-word-hash@1-d<dimensions>`. It understands no
meaning and serves only sample data and checks.

**BAAI/bge-m3.** The first real model for German and English runs locally in
[Text Embeddings Inference](https://github.com/huggingface/text-embeddings-inference)
on the loopback address, for example:

```sh
text-embeddings-router --model-id BAAI/bge-m3 --revision <commit> \
    --hostname 127.0.0.1 --port 8080
```

`LocalEmbeddingModel` reads `model_id` and `model_sha` from `/info` and uses
`<model_id>@<model_sha>` as the model version, for example
`BAAI/bge-m3@<commit>`. It refuses another model,
a revision other than `--model-revision`, and a server that reports no revision
when none is passed. Texts go to `/embed` in batches of 16 with `normalize` and
`truncate`; bge-m3 embeds questions and passages alike, so no prefix is added.

**Same revision for source and question.** The version is read at the start of a
run and pinned. After every batch the worker reads `/info` again; a changed
revision stops the run with `EmbeddingModelChangedError` before the batch is
stored. `SearchIndexService.search` embeds the question with the same model and
compares it only with sections of exactly that model version.

**Model change.** Each model version is its own inventory in `search_embeddings`
and `search_index_sources`. A new version starts empty and indexes every source
anew next to the old one; the search uses only the version the configured model
serves. Once the new inventory is complete, `--remove-model` removes the old
one; the inventory of the current model is never removed this way.

## Sources and versions

| Source         | Indexed text                       | `source_version`                    | Included                                        |
| -------------- | ---------------------------------- | ----------------------------------- | ----------------------------------------------- |
| `ticket`       | `<key>: <title>`, then description | `sha256:<hash of the indexed text>` | Every ticket, archived ones too.                |
| `wiki_page`    | Title, then content                | Page `revision`                     | Pages outside the trash that are no templates.  |
| `ticket_asset` | File name, then the UTF-8 text     | SHA-256 of the bytes (the checksum) | Only assets released for the search, see below. |

Tickets have no revision counter, so the hash of their indexed text is their
revision. A source counts as changed when its fingerprint differs from the one
recorded for the model version: `sections-v1:<hash>` with the SHA-256 of the
indexed text, for assets the checksum. PostgreSQL computes the hashes of all
tickets and pages, so the worker reads only the text of new and changed
sources. Status changes or other fields outside the indexed text cause no new
embedding; a title change of a wiki page without a new revision does.

Visibility is not part of the index. The search filters the sections by the
`(source_type, source_id)` pairs the reader may see before ranking, as described
in [Search embeddings and pgvector](SearchEmbeddings.md#repository).

## Sections

Line ends are unified and the text is split into paragraphs at blank lines and
before Markdown headings. Paragraphs are joined into sections of at most 1200
characters. A heading starts a new section, except directly after the title, so
the title never stands alone when a heading follows. A paragraph longer than a
section is cut at the last sentence end, line break or space in its second half,
otherwise at the limit without splitting a character. Empty paragraphs give no
section. `section_index` counts from 0 in text order.

## Replacing and removing

Each source is written in one transaction: all sections of the source in that
model version are deleted, the new sections are inserted and the record in
`search_index_sources` (version, fingerprint, section count) is replaced. A run
therefore never leaves sections of two versions of a source, and a repeated run
on unchanged data writes nothing. An interrupted run continues with the
remaining sources on the next run.

Every run first compares all stored sources with the current ones. A deleted
ticket, a wiki page in the trash or deleted, a deleted attachment and an asset
whose release was withdrawn lose their sections and records in **every** model
version. A source that returns, such as a restored page or a renewed release, is
embedded anew.

## Released ticket assets

Only assets released for the search are read. People with the right to change a
ticket release or withdraw a file in the attachment list of the ticket with the
search button; images, audio and video offer no release. Everyone who can read
the ticket sees "Released for the search" next to a released file. The release
is stored in `ticket_asset_search_releases` and disappears with the attachment.
Archived tickets keep their releases and cannot be changed.

The first asset format is UTF-8 text. The worker opens the bytes with
`TaskAttachmentService.openStored`, the same server-side access the ticket asset
change readers use. It indexes an asset whose detected type is
`application/octet-stream`, which is at most 1 MiB, decodes as valid UTF-8 and
holds no NUL character; a byte order mark is dropped. Any other released asset is
recorded with zero sections and a log entry `search_index.asset_skipped`, so it
is not read again until its bytes change.

## Retrieval format

`SearchIndexService.search({ question, visibleSources, limit })` returns:

```json
{
  "modelVersion": "BAAI/bge-m3@<revision>",
  "hits": [
    {
      "sourceType": "ticket",
      "sourceId": "<ticket UUID>",
      "sourceVersion": "sha256:<hash>",
      "sectionIndex": 0,
      "sectionText": "SAMPLE-1: …",
      "cosineDistance": 0.157299
    }
  ]
}
```

| Field            | Meaning                                                                     |
| ---------------- | --------------------------------------------------------------------------- |
| `modelVersion`   | Model and revision that embedded the question and every compared section.   |
| `sourceType`     | `ticket`, `wiki_page` or `ticket_asset`.                                    |
| `sourceId`       | UUID of the ticket, wiki page or attachment.                                |
| `sourceVersion`  | Version the section was read from, see the table of sources.                |
| `sectionIndex`   | Position of the section in the source, from 0.                              |
| `sectionText`    | Text of the section as stored.                                              |
| `cosineDistance` | 0 for the same direction up to 2 for the opposite; hits come closest first. |

A component that shows or cites a hit checks the source again for the reader
and can compare `sourceVersion` with the current version to mark a section that
changed since it was indexed. The [hybrid search for agents](HybridSearch.md)
does both and hands over only sections of the current revision.

## Sample data

[`SearchIndexing.fixture.json`](SearchIndexing.fixture.json) holds fixed sample
sources with stable UUIDs: two tickets (English and German), a wiki page with two
headings, a released log file and an asset that is not released. It lists the
reports of two runs with the fake model `pages/deterministic-word-hash@1-d8` (the
second run changes nothing), the six resulting sections with source, version and
section, and the retrieval result for the question
`session refresh 401 after password change`. The values were produced by the
indexer on a disposable PostgreSQL 18 instance with pgvector 0.8.
