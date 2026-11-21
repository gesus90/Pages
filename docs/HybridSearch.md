# Hybrid search for agents

Agents answer questions from Pages content with one search that combines the
existing keyword search with the vector search over the
[local search index](SearchIndexing.md). It searches tickets, wiki pages and
ticket assets released for the search, applies the current read rights of the
person before ranking and limit, and hands over only sections the person may
see, each with the link of its source.

Sources: [operation](../backend/service/agents/AgentSourceSearchService.ts),
[search](../backend/service/search/HybridSearchService.ts),
[candidates and visibility](../backend/database/repositories/search/SourceSearchRepository.ts),
[contract](../definition/AgentSourceSearch.ts),
[sample data](HybridSearch.fixture.sql) and
[searches with expected results](HybridSearch.fixture.json).

## Where agents find it

| Surface    | Name                                 | Parameters                         |
| ---------- | ------------------------------------ | ---------------------------------- |
| Agent API  | operation `search.sources`           | `question`, `projectId?`, `limit?` |
| MCP server | tool `search_sources`                | as above                           |
| Pica       | native tool `sources_search` (Pages) | as above                           |

`question` has 1 to 1000 characters, `limit` 1 to 20 sections (default 10).
`projectId` limits the search to one project the person can open; a hidden or
missing project answers `NOT_FOUND`. Every account that may read in Pages gets
the operation; agent plan sessions get it with the `read` and `full` reach.

## Configuration

The keyword search needs nothing. The vector search needs the model the indexer
used, set in the environment of the Pages server:

| Variable                            | Meaning                                                                   |
| ----------------------------------- | ------------------------------------------------------------------------- |
| `PAGES_SEARCH_EMBEDDING`            | `local` for the embedding server on this machine, `fake` for sample data. |
| `PAGES_SEARCH_EMBEDDING_URL`        | Address of the local server, as `--embedding-url` of the indexer.         |
| `PAGES_SEARCH_EMBEDDING_MODEL_ID`   | Model the server must run, default `BAAI/bge-m3`.                         |
| `PAGES_SEARCH_EMBEDDING_REVISION`   | Revision the server must run; required when the server reports none.      |
| `PAGES_SEARCH_EMBEDDING_DIMENSIONS` | Dimensions of the fake, default 64.                                       |

Without `PAGES_SEARCH_EMBEDDING` the search answers with the keyword search
alone. An unknown value, a missing address or an address off this machine is
logged as `search.embedding_configuration_invalid` at start and has the same
effect. Every search builds
its own client, so it compares the question with the inventory of the revision
the server serves at that moment; a model change needs no restart.

## How a search runs

1. **Fixed candidates.** The question gives three lists of candidates: up to
   20 tickets of the keyword search over key, title and description, up to 20
   wiki pages of the existing wiki search (every word must occur, as in the
   search dialog), and the 40 nearest sections of the vector search. Ticket
   numbers written in the question, such as `SAMPLE-1` or `sample-1`, are
   looked up exactly as a fourth, lexical list. Punctuation at the edges of a
   word, such as the question mark, is dropped for the keyword search.
2. **Visibility before ranking.** Every list is read with the visibility of
   the person, resolved anew from the database for this search: wiki pages
   with the rule of the wiki search (scope, project, private pages, anchors
   and hidden ancestors), active tickets with the ticket rule of the wiki
   (readable project and, for tickets with departments, one of the person's
   departments; administrators in admin mode see every department), and
   released assets of such tickets. The vector search applies the same query
   in its `WHERE` clause, before its distance order and limit.
3. **Current revision.** All candidates are read again in one step, inside the
   same visibility, in their current revision. Tickets and wiki pages are cut
   into sections exactly like the indexer does. A vector hit counts only when
   its `sourceVersion` is the current revision and, for tickets and pages, its
   text equals the current section; otherwise it is left out and counted in
   `staleSections`. Keyword hits hand over the sections of the current text
   that hold the most searched words, at most two per source.
4. **Ranking and limit.** Exactly named ticket numbers come first, in the order
   of the question; they stay lexical hits whatever the vector search finds.
   All other sections are ordered by reciprocal rank fusion
   (`1 / (60 + rank)` summed over the lists that found the section), then by
   source and section. Only then is the list cut to `limit`.

A source the person may not see is neither returned nor counted, also not in
`staleSections`. Because the rights are read for every search without a cache,
a removed department membership, project assignment, ticket department or asset
release takes effect with the next search, before the index runs again.

## Fallback to the keyword search

The vector search never fails the search. `vectorSearch` tells what happened:

| `vectorSearch`                                                 | Meaning                                                           |
| -------------------------------------------------------------- | ----------------------------------------------------------------- |
| `{ status: "used", modelVersion }`                             | The question was embedded and compared with that model version.   |
| `{ status: "unavailable", reason: "notConfigured" }`           | No model is configured.                                           |
| `{ status: "unavailable", reason: "embeddingFailed" }`         | The model or the comparison failed, for example a stopped server. |
| `{ status: "unavailable", reason: "vectorSearchUnavailable" }` | pgvector is not activated in the database.                        |
| `{ status: "unavailable", reason: "timeout" }`                 | Embedding and comparison took longer than 5 seconds.              |

In every unavailable case the server logs `search.vector_unavailable` with the
reason, and the keyword search and the exact ticket numbers answer alone. A
rephrased question without the searched words then finds nothing.

## Result

```json
{
  "sections": [
    {
      "sourceType": "ticket",
      "sourceId": "<ticket UUID>",
      "title": "SAMPLE-1: Session refresh fails with 401 after password change",
      "link": "/tasks/SAMPLE-1",
      "ticketKey": "SAMPLE-1",
      "projectId": "<project UUID>",
      "sourceVersion": "sha256:<hash>",
      "sectionIndex": 0,
      "text": "SAMPLE-1: Session refresh fails …",
      "matchedBy": ["ticketKey", "vector"]
    }
  ],
  "vectorSearch": {
    "status": "used",
    "modelVersion": "BAAI/bge-m3@<revision>"
  },
  "staleSections": 0
}
```

| Field           | Meaning                                                                           |
| --------------- | --------------------------------------------------------------------------------- |
| `sourceType`    | `ticket`, `wiki_page` or `ticket_asset`.                                          |
| `title`         | Key and title of a ticket, title of a page, file name of an asset.                |
| `link`          | `/tasks/<key>`, `/wiki/<page id>` or `/aufgaben/attachments/<attachment id>`.     |
| `ticketKey`     | Key of the ticket, also of the ticket an asset belongs to; `null` for wiki pages. |
| `projectId`     | Project of the source; `null` for instance and private wiki pages.                |
| `sourceVersion` | Current revision: ticket text hash, page revision or asset checksum.              |
| `sectionIndex`  | Position of the section in the source, from 0, as in the index.                   |
| `matchedBy`     | `ticketKey`, `keyword` and `vector`, every part of the search that found it.      |

Agents cite the `link` of every section they use. Pica is told so in its
instructions.

## Sample data for checks

[`HybridSearch.fixture.sql`](HybridSearch.fixture.sql) holds two departments,
two persons with a department-bound role, two projects, four tickets (one with
a department of its own), an instance page, a project page and a released
text asset. [`HybridSearch.fixture.json`](HybridSearch.fixture.json) lists the
steps in order with the expected sections: allowed reads, a ticket number in
lower case, a rephrased question, a ticket number the reader may not see,
the project limit, a hidden project, the four fallbacks, a changed ticket
before the next indexing run, and withdrawn rights (asset release, ticket
department, department membership). The results were produced on a disposable
PostgreSQL 18 instance with pgvector 0.8 and the fake model
`pages/deterministic-word-hash@1-d64`.

To repeat them on a disposable instance, never on one with real data:

1. Set up a fresh instance, activate pgvector as superuser
   ([Search embeddings and pgvector](SearchEmbeddings.md#activation-and-deactivation))
   and load `HybridSearch.fixture.sql` as the role of `databaseUrl`.
2. Write the asset bytes given in the JSON to the path it names in the data
   directory; their SHA-256 must equal the stored checksum.
3. Run `pnpm run search:index <config.toml> --model fake` twice and compare the
   reports.
4. Start Pages with `PAGES_SEARCH_EMBEDDING=fake`. The fixture accounts have
   no usable password: let an administrator set one for Alice and Bob, sign in
   as each, create a personal agent credential and call `search_sources` with
   the parameters of each step. Run the SQL of the change steps in between; the
   fallback steps stop the embedding (unset the variable, point
   `PAGES_SEARCH_EMBEDDING=local` at a closed port or a server that answers
   late) or deactivate pgvector.

The [RAG acceptance](RagAcceptance.md) runs the whole flow automatically on a
larger synthetic data set, with the keyword search compared against the hybrid
search, and records its results.

The fake model understands no meaning: it finds the rephrased question through
shared words such as `401`, `refresh` and `password`, while the keyword search
needs every word. With `BAAI/bge-m3` the order of the vector hits differs.
