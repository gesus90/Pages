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

## Test population follow-up

Checked on 2026-11-16 against starting revision `e78b85b2` in a clean working
tree. The earlier inventory counted 486 test paths whose basename starts with a
planning identifier. The count is reproducible on the parent of the suite
removal: `git ls-tree -r --name-only 8837f22c^ -- tests` lists 2,332 files, 486
of which match the planning-prefix pattern. That removal, recorded in
`docs/TestCiRemoval.md`, deleted the whole test population. At the current
revision the same searches find no test file, test path, fixture or test name.

The current check used tracked paths and case-insensitive matching:

```sh
git ls-files | grep -Ei '(^|/)(tests?|__tests__|specs?|fixtures?|mocks?|snapshots?|testing)(/|\.|$)|\.(test|spec)\.[a-z]+$'
git ls-files | grep -Ei '(^|/)(PAGE|page)[-_ ]?[0-9]+'
git ls-tree -r --name-only HEAD -- tests
git grep -nEi 'tests/|vitest|jest|@playwright/test|testing-library|jsdom' -- ':!docs/**'
```

- The path-component and file-extension pattern yields one wiki document;
  outside `docs/wiki/` the count is zero. `git ls-tree` lists no entry below
  `tests/`.
- Basenames that start with a planning identifier occur 62 times: 24 under
  `docs/` outside the wiki and 38 under the excluded wiki tree. None is a test
  path.
- The content search outside `docs/` finds only product uses, retained
  generated-output classifications and historical handoff documents. Those
  documents are not test files; their cleanup belongs to the separate
  documentation work.

No test file, fixture or test name was changed, renamed or removed here, and no
test or assertion was weakened or deleted; the tracked test population is empty.
The product's ticket-key handling and neutral sample data are untouched, as are
user-facing test features such as connection tests and tool activity
classification, which are product behavior rather than repository tests.

The following remain deliberately open or out of scope:

- Wiki content under `docs/wiki/` is cleaned by its own task.
- Historical handoff documentation outside `docs/` still quotes removed test
  paths, names and commands; it is documentation, not a test contract.
- The generic Python `unittest` example in the script-runtime guide describes a
  user-supplied external project, not a Pages suite.
- Targeted test runs and formatting checks were not executed: the assignment
  limits this step to implementation and functional review, and no code or test
  path changed. The empty population is verified by file inventory, not by a
  test run.

## Source, script and configuration cleanup

This cleanup covered tracked source, script and configuration files below
`backend/`, `app/`, `definition/`, `scripts/`, `deploy/`, `core/` and
`language/`, plus the tracked root files, with these extensions: TypeScript,
TSX, JavaScript, MJS, CJS, CSS, Rust, shell service units, environment examples,
TOML, YAML, nginx examples and HTML. It changed 1,476 source, script and
configuration files and removed planning identifiers from comments and from
five string occurrences in four files.

The following populations were deliberately not edited:

- Markdown documentation, including `docs/`, wiki content, source-tree README
  and capability documents. Documentation is a separate area, as the assignment
  states for wiki content; its references need their own review of readers and
  consumers.
- Applied SQL migrations. Changing them can affect existing installations, and
  the assignment excludes bulk changes to migrations.
- The lockfile, generated output, licenses and local-only files.
- Product domain data that only looks like a planning identifier: agent plan
  step contract IDs, swarm helper labels, Markdown heading levels, keyboard
  keys, audio codecs and technical tokens such as `SHA-256`, `UTF-8` or
  `ISO-8601`.
- Neutral ticket-key examples in interface documentation, for example a key
  shaped like a project prefix with a running number. The product needs them to
  explain how a ticket is addressed; they do not refer to or explain a
  development planning ticket.

The searches used tracked paths and matched ticket keys, work-package and
decision identifiers with letter, number and subnumber, section references into
an internal design document, numbered MCP interfaces and phrases such as "see
ticket", "according to epic" and "work package". A script collected comment
ranges through the TypeScript parser, the Rust, CSS, shell and configuration
comment syntax, and rewrote only those ranges. Functional string literals were
left untouched except for four texts: one administration tool description lost
a planning key, and three neutral example keys in prompts and event examples
were normalized to the same neutral placeholder.

Results before and after, counted in the covered file population:

- Ticket-key references: 2,955 before, 34 after. All 34 remaining occurrences
  are neutral ticket-key examples in interface documentation.
- Work-package and decision identifiers: 125 before, 1 after. The remaining
  match is an SVG path coordinate, not a planning identifier.
- Design-document section references, numbered interfaces and similar internal
  numbering: 121 before, 0 after.

The changed TypeScript and JavaScript files were parsed with the TypeScript
parser; 1,455 files reported no syntax error. The changed Rust, CSS, shell unit
and environment example files were reviewed by reading their diffs; only comment
text changed. No lint, typecheck, formatting check, test suite or coverage run
was executed, because the assignment limits this step to implementation and
functional review. Those checks remain with the closing QA step.

## Wiki content cleanup

The visible Pages project wiki and the versioned wiki content were checked
separately on 2026-11-16. The live wiki is the authoritative product
documentation; `docs/wiki/` holds versioned drafts, implementation notes and
historical acceptance evidence. The two are not synchronized automatically.

The live wiki inspection covered all 91 visible pages in the project tree. The
search matched ticket keys, task links, work packages, decision and function
numbers, plan-run references and process phrases. Two pages contained planning
references:

- `Events, Benachrichtigungen und Backups` defined the status
  "Umgesetzt (Arbeitspaket)" and tied it to the work package. The status is now
  "Umgesetzt (belegt)" and requires a documented actual state.
- `Ergänzungen und Herkunft der Festlegungen` referred to the "Abschlussbericht
  des jeweiligen Arbeitspakets". It now refers to the respective final report.

The product term "Arbeitspaket" remains on the provenance page as the former
name of a ticket type; it describes product terminology, not a work package.
No ticket key, task link or plan-run reference remains in the visible wiki.
The repeated search after the change found no other planning reference.

The versioned wiki content was checked with the same patterns. Twenty-six files
under `docs/wiki/` were edited. Ticket keys were removed from titles, headings
and prose and replaced with descriptive statements about the behavior, the
change or the earlier state. Neutral ticket-key examples remain in two product
examples; they explain the product's addressing format and do not refer to a
planning ticket. Two cross-reference paths remain in the edited drafts; their
visible link text no longer contains a ticket key.

The historical acceptance report and the machine-readable evidence under
`docs/wiki/` were not rewritten. They contain ticket keys and work-package
references as part of their recorded before/after states, hashes and link
graphs; changing them would falsify the evidence. The report retains the date,
scope and limitations of the wiki split.

The 38 paths under `docs/wiki/` whose path contains a directory or basename
starting with a ticket key were not renamed. The assignment forbids moving wiki
pages, and the evidence package refers to the file names in its manifest and
snapshots. The paths are historical anchors, not content references; a later
path cleanup needs its own review of the evidence consumers.

The repeated search after the change found the following justified hits:
ticket keys in the unchanged historical report and evidence package, the two
neutral product examples, the two cross-reference paths, and the section anchor
of a non-wiki technical guide. No other planning reference remains in the
edited wiki content. The anchor belongs to a versioned technical guide outside
the wiki; changing it would also touch its historical report link and needs its
own review.

No live service, live data, credentials or production code were changed. The
two live wiki pages were read before the change and after saving; the stored
revisions are 17 and 6. The repository changes are on the session branch and
were committed with a message starting with the ticket key. Lint, check,
typecheck, formatting, tests and coverage were not executed because the
assignment limits this step to implementation and functional review.

## Developer documentation cleanup

The versioned developer documentation was reviewed on 2026-11-16 in a clean
working tree on the session branch. The reviewed population was the 56 tracked
files under `docs/` outside `docs/wiki/`. Twenty-four of those paths carry a
planning identifier in their basename. The review also read the Markdown files
that current guides link to outside `docs/`: `README.md`,
`deploy/core/README.md` and `backend/service/agents/ScriptRuntime.md`.

The searches covered tracked files only and used case-insensitive matching for
the ticket-key and planning-term patterns:

```sh
git grep -nE -i 'PAGE[-_ ]?[0-9]+' -- 'docs/**' ':(exclude)docs/wiki/**'
git ls-files docs | grep -Ei '(^|/)(PAGE|page)[-_ ]?[0-9]+'
git grep -nE -i '/tasks/|task/[a-z-]*page' -- 'docs/**' ':(exclude)docs/wiki/**'
git grep -nE -i 'page[0-9]{3}' -- 'docs/**' ':(exclude)docs/wiki/**'
git grep -nE -i '\bT[0-9]{1,2}\b' -- 'docs/**' ':(exclude)docs/wiki/**'
git grep -nE -i 'Arbeitspaket|Nachlauf|Entscheidung [A-Z][0-9]|Funktion [A-Z][0-9]|Thema [A-Z][0-9]' -- 'docs/**' ':(exclude)docs/wiki/**'
git grep -nE '#[a-z0-9-]*page[-_ ]?[0-9]+' -- 'docs/**'
```

The current guides were also checked with a local Markdown link and anchor
checker. It resolves relative file links, compares heading anchors and reports
missing files or anchors; the checker is a temporary working aid and is not
part of the repository.

The ticket-key search found 689 matching lines in 50 files outside the wiki
before the change and 448 lines in 30 files after it. Fourteen of the remaining
lines are link destinations in current guides; their link text is descriptive.
Twelve are the historical path list in this audit. The other 422 lines are in
historical evidence documents. The test-slug count
fell from 311 to 302 and the work-package/evidence-ID count from 60 to 48. The
remaining matches are in historical records, except the audit's own quoted
search terms. No conclusion that the historical evidence is current follows
from these counts.

Twenty-five current guides were edited: `AgentPlanRunner.md`,
`AgentRuntime.md`, `AgentWorkerMemory.md`, `Automations.md`,
`IntegrationsService.md`, `LocalAgentSessions.md`, `McpCalendar.md`,
`McpUserManagement.md`, `Operations.md`, `PagesRunner.md`, `Pica.md`,
`PicaAdminOperator.md`, `PicaAdminTools.md`, `PicaMobileNotifications.md`,
`PicaMobileWebSocket.md`, `PicaOperatorBrowser.md`, `PlanRuntimeFootprint.md`,
`PostgresMigration.md`, `README.md`, `RemoteConsole.md`, `RemoteSetup.md`,
`RequestCorrelation.md`, `StorageApi.md`, `UserGuide.md` and `ZaiAccountType.md`.
Seventy-five headings that contained a ticket key were renamed and their anchors
were updated in the same guides, in the historical reports and in the one
affected wiki cross-reference. The changed anchors include the runner,
worker-unit, Pica, storage, operations, logging and plan-editor sections.

The edits removed ticket keys and planning references from titles, headings,
prose, TOC links and examples. Facts, limits, error codes, operation names,
sources, decisions, operational instructions and license notices remain. Two
neutral product examples now use `PROJ-42` instead of a real planning key. The
evidence identifiers in the storage guide became descriptive check names, and
the historical evidence rows in the plan guide became a short prose summary of
the same checks. Removed with the rows were the old test names; those test files no
longer exist. The "Lauf 6" and
"Ticketprotokoll" wording in the plan guide was replaced by neutral wording.
The guide index now describes the historical Pica inventory without a planning
key in the visible link text.

The following findings are deliberately open and are not presented as checked
or implemented:

- The 24 paths whose basename starts with a planning key were not renamed:
  `PAGE-169.md`, `PAGE-184-185.md`, `PAGE-199.md`, `PAGE-290.md`,
  `PAGE-293.md`, `PAGE-296.md`, `PAGE-298.md`,
  `PAGE-322-confirmation-inventory.md`, `PAGE-323-report.json`,
  `PAGE-328-report.json`, `PAGE-330-report.json`, `PAGE-332.md`,
  `PAGE-333.implementation.json`, `PAGE-333.qa.json`, `PAGE-340.md`,
  `PAGE-368.md`, `PAGE-383.md`, `PAGE-384.md`, `PAGE-385.md`, `PAGE-395.md`,
  `PAGE-436.md`, `reports/PAGE-316.md`, `reports/PAGE-407.md` and
  `reports/PAGE-412.md`. They are dated evidence, not current guidance. Their
  contents contain the original keys, commit identifiers, test paths, hashes
  and acceptance results; rewriting them would falsify the record. The
  machine-readable JSON reports are also external handover inputs. Their
  names are link and evidence anchors; no rename was made.
- `docs/PAGE-332.md` and `PicaRuntimeInventory.md` are historical inventories.
  Only their link targets were updated to the renamed current headings; the
  historical text remains. The same applies to `reports/PAGE-407.md` and
  `reports/PAGE-412.md`.
- Current guides still link to historical documents in fourteen places. The
  visible link text is descriptive, but each destination path carries its
  historical key. Renaming those targets would break the evidence references
  described above and was left open.
- At this audit revision, four links in historical documents still targeted
  the removed test guide. They were subsequently removed; see the
  [test documentation audit](TestCiDocumentationAudit.md).
- `docs/repository-reference-audit.md` retains the word "Arbeitspaket" in its
  earlier wiki-cleanup record because it quotes the former status label and
  search term. It is a historical record, not a current planning reference.

At that audit revision the link checker reported four pre-existing links to
the removed test guide; those links have since been removed. At that time no
changed guide had a broken heading anchor. `git diff --check` reported no whitespace errors. No production code,
migration, live service, live data or credential was changed. The repository
changes are on the session branch and were committed there; nothing was pushed
to `main`. Lint, typecheck, formatting, build, tests and coverage were not run
because the assignment limits this step to implementation and functional
review.

## Source-tree documentation and path review

On 2026-11-16 the tracked inventory contained 4,747 files. The review covered
24 Markdown and text documents below the repository root, excluding `docs/`
and test or fixture directories. It also searched every tracked path component
outside `docs/wiki/` for ticket-key and numbered work-package patterns. Product
terms such as ticket and milestone, version numbers, migration numbers and
license notices are not internal planning references.

The path search found 24 historical evidence files under `docs/`, including five
JSON handoffs. No other tracked path outside the excluded wiki matched. The
historical Markdown reports are referenced from current guides, other reports,
the wiki and the inventory; the JSON files contain recorded paths and
self-identification. Repository text searches cannot establish all external
consumers, retained links or handoff contracts. All 24 names remain unchanged
pending identification of those consumers and a migration agreement. This is an
open contract question, not a claim that renaming them would be safe. No source
entrypoint, import or build configuration was changed.

Fifteen source-tree guides were edited to replace planning labels with the
behavior they describe. The remaining matching destinations refer to the
unchanged historical reports. Historical evidence sections retain exact former
branch names, removed test paths, commands and measurements as provenance; they
are not instructions to execute those removed suites. Pica's runtime identity
files and license notices remain unchanged. Current product terminology and
neutral ticket examples remain where they describe product behavior.

The review compared each changed passage with its earlier text, searched tracked
files including wiki content for all 27 former heading anchors, and found no
references to those anchors. No file was renamed. The existing historical
handoff links retain their targets. No live services or data were used. Lint,
typecheck, check, build, formatting, tests and coverage were not executed at the
assignment's direction.
