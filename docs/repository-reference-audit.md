# Repository reference audit

The inventory covers paths tracked by Git and text in tracked files. Wiki-specific
content under `docs/wiki/` is outside the cleanup; links and consumers must still
be checked before moving any target. Git history, local caches, generated output,
licenses and applied migrations are not bulk-edited. Product ticket and agent
plan terminology, protocol values and neutral examples can be functional data.

The initial inventory contained 7,145 tracked paths. The following searches were
used, with case-insensitive matching for the path and planning-term searches:

- `git ls-files`, filtered for path components containing `page` followed by a
  number, found 555 paths: 7 assets, 62 documentation paths and 486 test paths.
  This deliberately includes the excluded wiki directory.
- `git grep -nE 'PAGE[-_ ][0-9]+' -- ':!docs/wiki/**'` found 4,041 matching
  lines. This is a candidate count, not a count of removable references: it
  includes product examples and migration contents.
- A search for `Arbeitspaket`, `Planlauf`, `Plan run` and task URLs found 167
  matching lines outside wiki content. Ordinary product plan runs are among them.
- The ticket-key search in migration directories found 78 matching lines.
  Applied migrations are retained because changing their contents can affect
  existing installations.

Seven asset paths have been renamed to describe their contents. The static
imports and the attribution notice were updated. The bytes and the source and
license information were retained. A search for the previous asset names found
no remaining tracked text references. The focused frontend tests for the two
consumers passed: two files, seven tests. Lint, check, typecheck, formatting,
coverage and full suites are handed over to final QA.

The remaining inventory requires individual review. In particular, test paths
include fixtures imported by other tests; their imports, dynamic paths and
configuration must be checked for every rename. Documentation includes reports
and machine-readable handoffs whose consumers and retained factual content need
review. Source matches include comments as well as contract values and neutral
product examples. The counts above do not establish which of those are safe to
change. No conclusion that the repository cleanup is complete follows from the
asset work.

## Follow-up inventory

The asset changes were recovered from the earlier local commit because they
were absent from the current branch. The seven renamed files retain their
original Git blob contents; the Drive icon also matches the digest in its
notice. The model-picker and Drive settings unit tests passed again: two files,
seven tests, with coverage disabled. The old asset names have no tracked text
references. The service operations guide also replaces four historical labels
with descriptions of the actual behavior, retaining its security and migration
instructions.

The follow-up search used `git ls-files` for tracked paths and case-insensitive
matching for planning identifiers, task URLs, work packages and decisions in
tracked Markdown and text files outside `docs/wiki/`. It found 472 candidate
lines and 548 paths whose basename starts with a planning identifier: 62 under
documentation, including excluded wiki content, and 486 under tests. These
are candidates, not a count of removable references. The search also includes
product examples and instructions which must be assessed in context.

The remaining candidates have not been individually reviewed or cleaned up.
Some test fixtures have both static and dynamic imports, and browser support
scripts are documented as command entrypoints. Machine-readable historical
handoffs also contain paths and self-references; their external consumers and
retention requirements are not established by a repository text search. These
paths have therefore not been renamed. Applied migrations and wiki content
remain outside this cleanup. Lint, check, typecheck, formatting, coverage and
complete suites are handed over to final QA.
