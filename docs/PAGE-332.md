# PAGE-332: documentation inventory and verification

Source checkout: `5c6a3aae` (2026-11-13), prepared session branch. The original
README had 3,191 lines. Changes are documentation and comments only.

## Disposition of the original README

Existing topic pages were extended first: AgentPlanRunner, RemoteSetup,
IntegrationsService, StorageApi, RequestCorrelation and tests/README. Their
existing content and prior-ticket evidence remain. New guides cover subjects
without a suitable current general guide: user behavior, Pica chat, optional
agent runtime, instance configuration and contributor architecture/commands.
PicaRuntimeInventory is explicitly a historical pre-PAGE-157 inventory and was
not repurposed as a current operator manual. The documentation index connects
both general guides and specialized existing pages.

Requirements/install/first-start text was corrected from code; duplicate unit
and browser introductions link to the existing authoritative test guides.
The product summary, security notes and MIT/React Flow notices remain in README.
The banner remains labelled as an illustration; the available viewer baseline
is a cropped synthetic component fixture, not a current product overview.
No new screenshot was captured and no competitor image was imported.

| Former README section | Current destination |
| --- | --- |
| About | [README.md](../README.md#about) |
| Tech stack | [docs/Development.md](Development.md#tech-stack) |
| Architecture | [docs/Development.md](Development.md#architecture) |
| Navigation and draft saving | [docs/UserGuide.md](UserGuide.md#navigation-and-draft-saving) |
| Ticket and milestone archive rights | [docs/UserGuide.md](UserGuide.md#ticket-and-milestone-archive-rights) |
| GitHub issues: Done and archive | [docs/IntegrationsService.md](IntegrationsService.md#github-issues-done-and-archive) |
| Discord notifications | [docs/IntegrationsService.md](IntegrationsService.md#discord-notifications) |
| Set up the Discord application (once per instance) | [docs/IntegrationsService.md](IntegrationsService.md#set-up-the-discord-application-once-per-instance) |
| Bot permissions | [docs/IntegrationsService.md](IntegrationsService.md#bot-permissions) |
| Connect a project | [docs/IntegrationsService.md](IntegrationsService.md#connect-a-project) |
| What is sent | [docs/IntegrationsService.md](IntegrationsService.md#what-is-sent) |
| Delivery and failures | [docs/IntegrationsService.md](IntegrationsService.md#delivery-and-failures) |
| Manual acceptance with a real server | [docs/IntegrationsService.md](IntegrationsService.md#manual-acceptance-with-a-real-server) |
| Google Drive sign-in (PAGE-170) | [docs/StorageApi.md](StorageApi.md#google-drive-sign-in-page-170) |
| Set up the Google OAuth client (once per instance) | [docs/StorageApi.md](StorageApi.md#set-up-the-google-oauth-client-once-per-instance) |
| Sign-in, storage and account binding | [docs/StorageApi.md](StorageApi.md#sign-in-storage-and-account-binding) |
| Proof, renewal and limits | [docs/StorageApi.md](StorageApi.md#proof-renewal-and-limits) |
| Storage: Google Drive file area (PAGE-188) | [docs/StorageApi.md](StorageApi.md#storage-google-drive-file-area-page-188) |
| Pica native tools (PAGE-157) | [docs/Pica.md](Pica.md#pica-native-tools-page-157) |
| Pica execution budgets (PAGE-103) | [docs/Pica.md](Pica.md#pica-execution-budgets-page-103) |
| Pica over Codex ACP (PAGE-68) | [docs/Pica.md](Pica.md#pica-over-codex-acp-page-68) |
| Pica over Claude Code ACP (PAGE-90) | [docs/Pica.md](Pica.md#pica-over-claude-code-acp-page-90) |
| Pica over native OpenCode ACP (PAGE-91) | [docs/Pica.md](Pica.md#pica-over-native-opencode-acp-page-91) |
| Pica live activity (PAGE-103) | [docs/Pica.md](Pica.md#pica-live-activity-page-103) |
| Pica sessions and conversation context (PAGE-48) | [docs/Pica.md](Pica.md#pica-sessions-and-conversation-context-page-48) |
| Pica quota demo (PAGE-96) | [docs/Pica.md](Pica.md#pica-quota-demo-page-96) |
| Pica's mascot and protected instructions (PAGE-51) | [docs/Pica.md](Pica.md#picas-mascot-and-protected-instructions-page-51) |
| Mascot | [docs/Pica.md](Pica.md#mascot) |
| Protected `AGENTS.md` and `SOUL.md` | [docs/Pica.md](Pica.md#protected-agentsmd-and-soulmd) |
| Direct model selection and Pica (PAGE-124) | [docs/Pica.md](Pica.md#direct-model-selection-and-pica-page-124) |
| Ticket parameters and assets (PAGE-60) | [docs/AgentPlanRunner.md](AgentPlanRunner.md#ticket-parameters-and-assets-page-60) |
| Remote working directories (PAGE-138) | [docs/RemoteSetup.md](RemoteSetup.md#remote-working-directories-page-138) |
| Agent Plans | [docs/AgentPlanRunner.md](AgentPlanRunner.md#agent-plans) |
| Team plans and templates (PAGE-118) | [docs/AgentPlanRunner.md](AgentPlanRunner.md#team-plans-and-templates-page-118) |
| React Flow migration inventory and acceptance (PAGE-87) | [docs/AgentPlanRunner.md](AgentPlanRunner.md#react-flow-migration-inventory-and-acceptance-page-87) |
| Restart and resume after a disturbance (PAGE-127) | [docs/AgentPlanRunner.md](AgentPlanRunner.md#restart-and-resume-after-a-disturbance-page-127) |
| Plans in the Pica chat and for plan agents | [docs/AgentPlanRunner.md](AgentPlanRunner.md#plans-in-the-pica-chat-and-for-plan-agents) |
| No external MCP access | [docs/AgentPlanRunner.md](AgentPlanRunner.md#mcp-access-and-internal-bridges) |
| Getting started | [README.md](../README.md#getting-started) |
| Requirements | [README.md](../README.md#requirements) |
| Install and run | [README.md](../README.md#install-and-run) |
| Agent Tool & Runtime Manager (PAGE-69) | [docs/AgentRuntime.md](AgentRuntime.md#agent-tool--runtime-manager-page-69) |
| Linux provisioning and container deployment | [docs/AgentRuntime.md](AgentRuntime.md#linux-provisioning-and-container-deployment) |
| Native ACP resource scheduling (PAGE-81) | [docs/AgentRuntime.md](AgentRuntime.md#native-acp-resource-scheduling-page-81) |
| Limited worker units (PAGE-127) | [docs/AgentRuntime.md](AgentRuntime.md#limited-worker-units-page-127) |
| OpenCode plan nodes with a Console / Zen key (PAGE-66) | [docs/AgentRuntime.md](AgentRuntime.md#opencode-plan-nodes-with-a-console--zen-key-page-66) |
| ACP adapters for the CLI runners | [docs/AgentRuntime.md](AgentRuntime.md#acp-adapters-for-the-cli-runners) |
| First start | [docs/Operations.md](Operations.md#first-start) |
| Configuration | [docs/Operations.md](Operations.md#configuration) |
| Static app and entrance (PAGE-235) | [docs/Operations.md](Operations.md#static-app-and-entrance-page-235) |
| Behind a reverse proxy | [docs/Operations.md](Operations.md#behind-a-reverse-proxy) |
| Local services for Pica's operator browser | [docs/Operations.md](Operations.md#local-services-for-picas-operator-browser) |
| Data and runtime directories | [docs/Operations.md](Operations.md#data-and-runtime-directories) |
| Design themes (PAGE-36) | [docs/UserGuide.md](UserGuide.md#design-themes-page-36) |
| Server logging (PAGE-67) | [docs/RequestCorrelation.md](RequestCorrelation.md#server-logging-page-67) |
| Commands | [docs/Development.md](Development.md#commands) |
| CI test tags (`PAGE-290`) | [tests/README.md](../tests/README.md#ci-test-tags-page-290) |
| Sequential block linting (`PAGE-192`) | [docs/Development.md](Development.md#sequential-block-linting-page-192) |
| Unit tests | [tests/README.md](../tests/README.md#choosing-a-scope) |
| Browser tests (PAGE-172) | [tests/README.md](../tests/README.md#browser-suite) |
| Pica Mobile WebSocket endpoint (PAGE-148) | [docs/PicaMobileWebSocket.md](PicaMobileWebSocket.md#einrichtung-durch-einen-administrator) |
| Pica Mobile | [docs/PicaMobileWebSocket.md](PicaMobileWebSocket.md) |
| Repository layout | [docs/Development.md](Development.md#repository-layout) |
| Security notes | [README.md](../README.md#security-notes) |
| License | [README.md](../README.md#license) |

## Reconciliation against code

| Question | Checked evidence and decision |
| --- | --- |
| How does the UI render? | [react-router.config.ts](../react-router.config.ts) defaults to a static app; API mode contains no page components. [app/routes.ts](../app/routes.ts), [Vite](../vite.config.ts) and [build.mjs](../scripts/build.mjs) separate browser/server modules and build the app shell once. The old per-page SSR paragraph was replaced; PAGE-87's historical migration evidence is explicitly labelled. The factual SSR sentence in AGENTS.md was corrected too. |
| Which database runs? | [Database.connect](../backend/database/Database.ts) constructs PostgresExecutor; [PagesConfig](../backend/config/PagesConfig.ts) rejects a completed setup without databaseUrl. The [setup wizard](../backend/setup/SetupWizardService.ts) migrates and initializes PostgreSQL transactionally. No DuckDB runtime fallback remains. databasePath's parent still locates application files. |
| What did the wiki say? | Architecture page `6f4a24af-67bf-48a3-a89c-67f882b75647`, revision 6, was read through the authorized Pages tool. It explicitly dates the fallback transition to 2026-11-04 and the earlier technology snapshot to A1. The checkout is newer; the source-backed decision is PostgreSQL and static app/API. No private wiki link is offered as a public setup prerequisite and no wiki page was modified. |
| Which development processes? | [package.json](../package.json) defines dev and dev:api; [Vite](../vite.config.ts) forwards app requests to 127.0.0.1:5174 by default. [DevelopmentRuntime](../backend/runtime/DevelopmentRuntime.ts) reads the OS account's default configuration, so the guide requires a separate development account. The console token path must be opened on the static app origin. |
| What are first setup and paths? | [SetupConnection](../backend/setup/SetupConnection.ts), [SetupWizardService](../backend/setup/SetupWizardService.ts), [ConfigBootstrap](../backend/config/ConfigBootstrap.ts) and [PagesConfig](../backend/config/PagesConfig.ts) establish an empty public schema, private setup intent, configuration and application directories. [PostgresLocale](../backend/database/postgres/PostgresLocale.ts) defines UTF8/libc/byte-order/Unicode locale checks. |
| What else was stale? | StorageApi already documents writer operations and folder grants (PAGE-323); appended PAGE-188 navigation text now links to those current rights. [CliWorkerUnit](../backend/agents/cli/CliWorkerUnit.ts) and AgentWorkerMemory define the shared memory budget, replacing obsolete per-worker limits. [McpDevicePairingService](../backend/service/mcp/McpDevicePairingService.ts) and app/routes.ts implement paired-device API access; old claims of no external access were replaced, while internal bridges remain distinct. Typed confirmation words are historical after PAGE-322. Current plan team/cloning contracts precede the preserved legacy PAGE-118 description. |

The original README paragraphs were also compared with the destination corpus
using normalized whitespace/link labels. The 44 initially flagged paragraphs
were reviewed (including the script/example links, which were restored): product/badge presentation; corrected architecture, setup, paths,
permissions and worker memory; duplicate unit/browser summaries; preserved
mobile details in the specialized protocol; and the compact security/license
wording. Remaining detailed paragraphs were retained. Original heading coverage
is recorded in the inventory above; code-block headings were excluded.

## Executed checks

No new application behavior was introduced, so no application unit tests were
added. Existing focused regressions exercise the facts used in the quickstart.
They ran directly through the installed Vitest entrypoint to avoid the pnpm
version-switch failure below, with coverage explicitly disabled:

```sh
node node_modules/vitest/vitest.mjs run --config vitest.backend.config.ts \
  --coverage.enabled=false \
  tests/backend/backend/config/pages-config.unit.test.ts \
  tests/backend/backend/setup/database-location.unit.test.ts \
  tests/backend/database/postgres/locale.unit.test.ts
```

Result on 2026-11-13: **3 files passed, 63 tests passed**, exit 0, 731 ms.
Configuration tests stub the OS home, locale tests mock the database engine,
and the selected setup tests validate inputs without connecting to PostgreSQL.
No server, model, provider, real database or MCP process was started.

A task-specific Markdown link exercise used the installed `unified`,
`remark-parse` and `remark-gfm` parsers in a Node stdin script. It walked links,
images, definitions and HTML href/src attributes in all 18 changed Markdown
files, resolved paths from each containing document, excluded fenced examples,
and compared fragments with document heading slugs/explicit anchors. It also
checked incoming links to the root README across tracked Markdown and verified
that the original section inventory covers each heading. Results are recorded
below after the final content update. This was a documentation function check,
not lint, formatting, type checking, build or coverage.

The only comment-only non-Markdown edit is `.env.example`: its topic references
now point to Operations, IntegrationsService and StorageApi. Prose references to
CI tags in AGENTS.md, tests/README.md and PAGE-290.md were updated. Runtime error
messages referring readers to README's ACP adapters remain reachable through
the README documentation table; no production text/code was edited.

## External link reachability

Fourteen distinct HTTP targets were opened with the authorized web tool:

- The [Pages repository](https://github.com/gesus90/Pages),
  [React Flow](https://reactflow.dev/), its
  [SSR reference](https://reactflow.dev/learn/advanced-use/ssr-ssg-configuration),
  [bubblewrap](https://github.com/containers/bubblewrap),
  [Linux flock manual](https://man7.org/linux/man-pages/man2/flock.2.html),
  [Node descriptor reference](https://nodejs.org/api/child_process.html#optionsstdio)
  and the two versioned OpenCode source links in AgentRuntime returned pages.
- The four historical Actions run/job links in PAGE-290 returned GitHub pages;
  that is reachability evidence, not a rerun or a new CI verdict.
- Discord's developer portal returned its JavaScript-required shell.
  Google Cloud Console redirected to Google sign-in; the tool could not inspect
  the authenticated destination. Both consoles require the operator's own
  account. Authenticated console functionality was not tested.

Existing external source references were retained, not used to claim newly
verified provider behavior. The competitor repositories named in the ticket
were orientation only; their pages/images were not needed or imported.

## Boundaries and decisions

- Work stayed on `work/pages-session-4-20261113T144400Z-a89c0c82`. No branch
  switch, rebase, push, deployment, live configuration/data or credential change.
- A clean dependency installation, dev startup, wizard completion, browser and
  provider flows were **not executed**. README and the operator examples say so;
  code review and mocked regressions do not prove an end-to-end install.
- `node --version` returned v24.22.1. `pnpm --version` warned that switching to
  the pinned 11.23.0 was denied (OS error 13) and returned the host's 12.15.0.
  No package-manager installation, dependency repair or lockfile change was
  attempted. Use the pinned version when independently exercising the quickstart.
- The optional current screenshot was omitted: the repository has a banner and
  cropped synthetic component baselines, not a verified current product overview.
- The standalone MCP client is outside the workspace. Its installation and
  compatibility are explicitly unverified, rather than inferred from server APIs.
- Lint, check, TypeScript, formatting checks, build, full unit/browser/database
  suites and coverage were not run: **an die Abschluss-QA übergeben**.

Final documentation exercise: **18 changed Markdown files, 327 local link/fragment
checks, zero errors**. The final scan of 83 tracked Markdown files found ten incoming
root-README links; all resolved. All 65 original headings are represented in the
disposition table. All changed guides are reachable from README (60 Markdown
files reached through the documentation graph). Explicit private `/wiki/` links
were not introduced into the changed guides. This check also caught and corrected
relative links after moving sections and the former broken Log level fragment.

T1 is evidenced by README's product summary and Getting started; T2 by its
requirements/commands/first setup and the PostgreSQL prerequisite section;
T3 by Development's architecture/source references and the reconciliation table;
T4 by the 65-section inventory and destination guides; T5 by the link exercise
and HTTP reachability results; T6 by the retained security/license notices and
this explicit validation/boundary record. T7 is the local PAGE-332 commit on the
prepared branch; no publication is part of this task.
