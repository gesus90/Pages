# Frontend unit scope

PAGE-33 analyzes, extends and validates the standalone jsdom scope introduced by
PAGE-38. PAGE-32's Backend suite, reports and documentation remain independent.
Run the complete Frontend unit suite from the repository root with exactly:

```sh
pnpm run test:frontend
```

The command runs Vitest once with V8 coverage. It does not load the application's
Vite configuration, React Router development runtime, server entry or database
initialization. There is no root `test` script, all-scope command, alias or MCP
forwarder. `pnpm run test` is unavailable. Empty discovery fails.

## Discovery and selection rule

Every `tests/frontend/**/*.unit.test.{ts,tsx}` file is selected automatically;
new units need no registration. Mirror the source path when useful. Fixtures,
`setup.ts`, plain `.test.ts`, `.spec.ts`, `.integration.test.ts`, `.browser.test.ts`,
`.e2e.test.ts`, `.smoke.test.ts` and `.live.test.ts` do not match. Keep other test
kinds outside this unit tree and do not rename them to `.unit.test.*`.

Choose this scope by behavior: isolated React components, hooks, simulated DOM
interaction and client utilities belong here. A route's loader/action belongs to
Backend even when its file ends in `.tsx`; a mixed route's UI can be tested here
with server boundaries mocked. Test selection does not select all exports of a
source module for execution.

Select new cases by observable behavior and impact: user input and submission,
read-only/pending states, successful completion, rejection and retry, asynchronous
ordering, cancellation and keyboard/focus interaction. Prefer a missing behavior
at an existing boundary over repeating the same assertion in multiple scopes.
No snapshot count or coverage percentage determines the selection.

The scope guard tests the actual discovery glob with positive and negative paths,
checks the exact command/jsdom/setup/report configuration and scans direct imports
of all Frontend test sources and fixtures. It rejects Backend test imports,
independent MCP code, MCP transports, browser runners and subprocess imports.
This static scan complements boundary review; it cannot prove the absence of
arbitrary computed or transitive imports.

## Behavioral analysis and test boundaries

The UI's principal boundary is React state/DOM → router submit/fetcher or client
adapter → server. Tests observe rendered text, accessible roles and associations,
focus, disabled state, selected values, emitted form payloads and state after a
mocked response. They do not exercise server business logic or persistence.

PAGE-33 adds the following units without migrating or deleting existing tests:

| Area | Behaviors checked | Mocked boundary |
| --- | --- | --- |
| Setup draft | Step-specific validation; first rejected step; corrected errors; back navigation preserves fields; server path suggestions stop replacing edits | None: local React state and shared validation |
| Database path check | Empty input; 400 ms debounce; typing/unmount cancellation; stale answer isolation; network failure; one delivery per new token rejection | Router fetcher submit/data; fake timers; no filesystem or database |
| Setup access/completion | Missing/rejected/expired token; verified replacement; draft submission; pending state; field, location, network and completion refusals | Router fetcher; synthetic tokens and passwords |
| Authentication fields | Label/error/description associations; removal of obsolete errors; show/hide password preserves text and restores focus | Animation-frame timing only |
| Ticket checklist | Blank/trimmed additions via button and Enter; done/undone payload; removal; progress text; archived and pending controls | Router submit; no action execution |
| Label creation | Trimmed create payload; assign only a new matching id after catalog update; ignore old/already assigned labels; cancel pending assignment while retaining the editable draft | Router submit and revalidated catalog props |
| Wiki search | Empty/reset state; 250 ms debounce; filter encoding; loading/results; unmount cancellation | Router fetcher load/data; fake timers |
| Wiki uploads | Progress and name during a held upload; sequential files; generated image markdown; continue after typed/network errors; reset on next batch | Upload adapter; controlled promises; no XHR |
| Wiki comments | Blank draft; reply/quote form context; pending state; preserve draft and show server error; clear on success; Unicode count; cancel | Fetcher state/data and native form stand-in; no server action |
| Wiki conflict dialog | Visible comparison, hide comparison, explicit keep-mine/take-theirs callbacks | Resolution callbacks; real dialog and diff rendering |
| Searchable select | Labelled combobox/listbox, selected/unavailable value, case-insensitive multiword/keyword search, combined tags, empty results, disabled controls/options, focus, keyboard wrapping/selection/Escape/blur | Only `scrollIntoView`, because jsdom has no layout |
| Toasts | Last three messages, manual/timed dismissal, hover/focus pause with remaining duration, invalid events, cleanup | Fake timers; real document events |
| User management hooks | Intent-specific failures/blocking agents and pending state; fresh success closes once; reopening ignores old success; delayed loading avoids flashes | Router navigation/action data; fake timers |
| Personal connections | Confirmation before mutation; cancel; failed mutation retains selection; successful retry and validity feedback; ignore stale success | Router fetcher and toast notification; no MCP runtime |
| Connection route UI | Empty public loader view; instructions from version/origin metadata; recoverable error and retry button | Server auth/service factory fail if invoked; memory router has only a fixture loader; revalidation callback |

Existing regressions stay selected: Agent configuration/deletion/assignment,
plan graph/list and templates, group editing, run notes, chat sessions and
management, draft save/navigation errors, Discord UI/results/QR and client
responses. PAGE-33's additions complement these; no functional coverage is
inferred from PAGE-32's Backend validation.

## Isolation and excluded scope

Use explicit imports from `vitest`, React Testing Library and local typed
fixtures. The existing `setup.ts` registers DOM cleanup after every test.
Technical defaults restore spies and global/environment stubs; tests also reset
mutable mock responses and restore their own fake timers/prototype stubs.
Translations are real isolated i18next instances. Memory routers provide a render
context and fixture data, without importing or invoking production loaders or
actions. Unit render compositions are not live application flows.

No Backend, browser automation, E2E, smoke, integration or live-provider tests run.
jsdom simulates a DOM; these tests do not establish browser layout, responsive
appearance, scrolling geometry, native focus behavior on every browser, SSR
hydration or accessibility-tool compatibility. No real services, network,
DuckDB, external filesystem, provider or subprocess chains are used.

Pages-owned connection UI may be tested with public connection metadata and
mocked server/submit boundaries. Executable modules of the independent `mcp/`
package are neither subjects nor test dependencies, including through helpers;
no MCP server, client, process or transport starts. The Frontend config's one
exact `@/mcp/package.json` alias supports static version metadata in the mixed
connection route. It does not alias the package's source tree. Without this alias,
Vite's client transform fails and V8 silently omits that route after a parse
warning; the corrected report retains its untested server branches.

## Diagnostic coverage and remaining gaps

`coverage/frontend/` contains the terminal/file text table (`coverage.txt`), HTML
source/branch report (`index.html`), raw JSON counters (`coverage-final.json`) and
all four overall/per-module metric summaries (`coverage-summary.json`). Unimported
source files remain included. There are no thresholds or coverage-ignore comments.
Reports stay gitignored and are not committed.

The configured scope includes all `app/components/**/*.{ts,tsx}`,
`app/lib/**/*.{ts,tsx}`, mixed `app/routes/**/*.tsx`, `app/root.tsx`, `app/routes.ts`,
`definition/**/*.ts` and `language/**/*.ts`. Only `app/**/*.server.{ts,tsx}` is
excluded here because it belongs to Node. Tooling, SQL/assets, generated route
types, test infrastructure and independent MCP sources are outside this runtime
source set. Pure types have no runtime statements.

Mixed routes and shared modules deliberately appear in both diagnostic reports.
This Frontend run measures whole modules, including uninvoked server exports in
mixed routes; those branches remain visible. Reports must not be summed, and
Frontend numbers say nothing about Backend validation.

### Measured PAGE-33 result (2026-10-15)

`pnpm run test:frontend` passes with **208 tests in 42 files**, no failures or
skips, on Node 24.19.0 / pnpm 11.23.0 / Vitest 5.0.3. The 23 existing files
contribute 116 tests; 19 new files add 75 behavioral cases and 17 scope checks.
The configured glob selects no files outside `tests/frontend/` and has no
intersection with the 244 Backend unit files or the independent MCP test tree.

| Metric | Covered / total | Result |
| --- | --- | --- |
| Statements | 2,813 / 11,588 | 24.27% |
| Branches | 1,836 / 8,761 | 20.95% |
| Functions | 922 / 4,063 | 22.69% |
| Lines | 2,623 / 10,945 | 23.96% |

All **803 configured source modules** appear in the report; none is missing or
unexpected. **568 executable modules have no covered statements**; pure type
modules without statements are not counted as untested executable modules.
No server-file or independent MCP source enters this report.

The four setup state/check/access/completion hooks, checklist composition,
label-creation hook, wiki search/upload hooks, conflict dialog, user-action hooks
and delayed management indicator reach 100% in all four metrics for their tested
boundaries. This establishes neither server correctness nor complete application
flows. Representative remaining gaps are:

- `task-form-dialog.tsx`, `tasks-kanban.tsx`, `wiki-page-editor.tsx`, the login
  route and `root.tsx` have 0% statements. Rich editor behavior, ticket form and
  board interactions, many project/settings screens and route compositions need
  further isolated units.
- `wiki-comment-composer.tsx`: 100% statements, 68.75% branches; the new cases
  use a parent and quotation, leaving the no-parent/no-quotation alternatives.
- `use-searchable-select.ts`: 94.02% statements, 89.18% branches, 95.23%
  functions, 98.18% lines; pointer highlighting and direct trigger-close paths
  remain open despite the tested keyboard, filtering and selection paths.
- `toast.tsx`: 100% statements/functions/lines, 90% branches; focus moving
  between descendants inside one toast remains untested.
- `use-connections-actions.ts`: 97.72% statements, 82.35% branches, 100%
  functions/lines; successful revocation's focus restoration and some optional
  action/result alternatives remain open.
- `settings-connections.tsx`: 11.62% statements, 0% branches, 33.33% functions,
  11.90% lines. Its UI and retry export are tested; server loader/action paths
  deliberately remain uninvoked in this Frontend run.

One unchanged PAGE-74 multi-interaction regression exceeded Vitest's existing
5-second timeout while a full lint gate overlapped a test run. The complete
command then passed without concurrently started check/lint gates. CPU contention
is a suspected cause, not a proven one. No timeout, assertion, retry setting or
existing test was changed; timings on busy machines remain a limitation.

Coverage is diagnostic; these modules and branch gaps are follow-up opportunities,
not hidden exclusions or a claim of complete Frontend coverage.
