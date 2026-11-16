# Test and CI documentation audit

This audit used the clean session checkout at revision
`c7b4d0419a80c7372a776793c8bdb74a7733dc16` on 2026-11-17. The local commit
containing this document and its corrections can be found with
`git log -1 --format=%H -- docs/TestCiDocumentationAudit.md`; `git show --stat`
for that commit identifies every changed file. A separately reported prior
session commit `d33619b2` was not available as a Git object in this checkout;
its contents could not be compared or imported. The existing removal inventory
and subsequent backend foundation were retained and reconciled in place.

## Search and disposition

The review covered tracked Markdown, MDX, reStructuredText and text files,
root instructions and READMEs, guides and their links, deployment and backend
READMEs, the repository wiki drafts and the machine-readable documentation
reports. Licenses and generated/dependency directories were excluded from the
prose search. The live Pages wiki and external services were outside scope.
The inventory used `git ls-files`, `rg --files` and case-insensitive `rg` over
`test`, `spec`, `vitest`, `jest`, `playwright`, `cypress`, `coverage`,
`abdeckung`, `fixture`, `mock`, `snapshot`, `browser`, `e2e`, `ci`, `workflow`,
`pipeline`, `prüfung` and `pruefung`. A narrower search covered former paths,
runner configurations and package commands; JSON reports were searched
separately. Generic matches were inspected in context: a browser, connection
check, regular expression or runtime snapshot need not be test infrastructure.

The relevant changes are:

- The agent-plan guide no longer offers a removed proof program as a runnable
  example. The database guide no longer attributes the removed PostgreSQL
  regression environment to the current CI. Repository wiki drafts mark the
  former database and browser checks as removed historical checks.
- The historical CI record and documentation mapping no longer link to the
  deleted test guide. Their current reader is directed to the backend foundation.
  The earlier reference audit records that the four dead links were later fixed.
- The removal inventory now identifies itself as historical and links to the
  current foundation. Historical provider, recovery, session, runtime, mobile
  and implementation reports identify removed files and old commands as past
  evidence rather than current instructions. The documentation index links here.
- The old Pica runtime inventory labels its obsolete test conflict as historical.
  General coding rules, PostgreSQL operations, offline transfer, backup and
  restoration instructions remain: they have independent operating purposes.

Remaining references to removed paths in the historical reports and JSON
handoffs preserve the evidence and inputs of earlier runs; they are not proof
for this revision and are not executable guidance. The Python unit-test command
in the script-runtime guide is an example for an external project. Product
browser automation, connection checks and coverage-ignore restrictions have
independent purposes. Historical GitHub run links are evidence, not current CI
entry points. No external URLs or private wiki links were checked for availability.

## Current state and coordination

`package.json`, `vitest.backend.config.ts`, the coverage report script and
`.github/workflows/backend-tests.yml` were read together. The old suites and
workflow have been removed. A new backend foundation discovers colocated
backend test files and fails an empty collection; no such tracked test files
were found at the base revision. The workflow runs that command on pushes to
`main`, with coverage artifacts when produced. No successful run or measured
coverage is claimed here. See [the backend foundation](BackendTesting.md) for
its actual scope and [the removal inventory](TestCiRemoval.md) for the earlier
removal and retained operational utilities.

The historical removal inventory records external plans, automation, remote
workflow and queued-run dependencies as observed at that time. Their present
state was not accessed or changed in this repository-only assignment. Owners
must reconcile those integrations with the actual workflow before reuse or
publication; historical observations do not establish their current status.
Additional behavior suites and their validation are separate work. No old
suite, CI configuration or live application data was modified here.

## Verification and limits

The changed passages were read against the package manifest, workflow, runner
configuration, retained operating scripts and the earlier inventory. A local
Markdown relative-target scan found the four removed test-guide links before
the edit and none afterward; the remaining `chat:person/<ID>` match is a
product URI, not a filesystem link. This scan does not validate anchors,
external URLs, HTML links or dynamic links. Searches and file existence checks
were read-only; they did not run services or access live data.

Tests, coverage, lint, typecheck, check, build and format verification were
**nicht ausgeführt (Vorgabe Igor)**. The checks above establish documentation
consistency with inspected source, not application behavior or CI execution.
