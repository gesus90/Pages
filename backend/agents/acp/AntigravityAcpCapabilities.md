# Google Antigravity ACP

Pages runs the official ACP entry point of the Antigravity CLI, `agy acp`. It
replaces the earlier separate `agy_acp_server.par` adapter. Pages accepts a
stable CLI release from **1.5.9** on whose `initialize` answer names
`Antigravity ACP Server` with protocol version 1. The managed Linux x64/arm64
installation comes from the official GitHub release of
`google-antigravity/antigravity-cli`; Pages checks the SHA-256 digest of the
release asset before it extracts the `antigravity` program as `agy` into one
immutable tool generation. Installation, updates and rollback use Settings →
Agents → Tools; a running session keeps its pinned generation. Pages sets
`AGY_CLI_DISABLE_AUTO_UPDATE=1`, so a managed generation never replaces itself.

Every start names the connection's own context:
`agy acp --gemini-dir=<connection>/config --app-data-dir=antigravity-acp
--disable-telemetry`. The client identity stays `pages`; Pages does not pose as
another application. The CLI keeps its sign-in in
`<connection>/config/antigravity-acp/antigravity-oauth-token`. A sign-in of the
earlier adapter (`acp_token.json`) is not read by `agy acp`: such a connection
shows that a new sign-in is required, and the old file is kept.

Sources: [Antigravity CLI releases](https://github.com/google-antigravity/antigravity-cli/releases),
[changelog](https://github.com/google-antigravity/antigravity-cli/blob/main/CHANGELOG.md).
The CLI's protocol implementation defines the selectors and OAuth callback
contract described below.

## Connections and authentication

Add Google Antigravity under the existing local/CLI connections. Each connection
has its own Gemini and application folder, separate from the service user's
personal CLI state. The `oauth-personal` ACP method opens Google's
authorization page and owns an HTTP callback on `127.0.0.1` with a random port.
The earlier adapter used exactly this flow: an RFC 8252 loopback redirect with
PKCE (S256) and `state`, one request, 300 seconds, without a device code, a
hosted HTTPS callback or a pasted Google password. `agy acp` offers the same
`oauth-personal` method; Pages keeps the flow below and refuses a sign-in that
does not present such an authorization URL.

Pages presents the protected URL through the existing login polling resource,
only to the administrator who started that login. The user signs in and gives
consent in Google's own page on any device. A browser on the execution host
reaches the loopback callback directly. A browser on another device, such as
a phone using Pages over HTTPS, lands on `http://127.0.0.1:<port>/?state=…`,
which does not load there; the user pastes that address into Settings. Pages
accepts it once, only from the login's owner and only with exactly the port
and `state` of that login's authorization URL, and only for a PKCE URL. It then
sends the unchanged query to `127.0.0.1:<port>` on the server, which is the
redirect URI Google already validated, like a one-request tunnel. Pages does
not rewrite the redirect URI, choose another target, follow redirects or
redeem the code: the adapter checks `state` and exchanges the code with its
own verifier. Neither the address nor the code is logged or returned.

Each login writes into a fresh staging context (`<connection>/login`). Only
after the CLI succeeded and a model-free status check confirmed the staged
account does Pages move `settings.json` and `antigravity-oauth-token` into the
connection context, by rename, and check that context again. A failed,
cancelled or expired attempt removes the staging context; the connection's
previous account stays valid and keeps its signed-in state. Pages ends the
session after 300 seconds, before the adapter closes its listener.
Antigravity's metadata and login probes require Linux bubblewrap with an owned
PID namespace. Once the namespace supervisor exits, its descendants are gone;
Pages does not inspect other processes' environments for those probes. Plan
sessions already require that same namespace boundary.

A confirmed
Antigravity plan closeout stores the namespace evidence with its session so a
later plan check can rely on the destroyed namespace. Older and unconfirmed
sessions do not acquire that evidence retroactively.

An operator can bind one existing dedicated context in place by setting both
`PAGES_ANTIGRAVITY_CONNECTION_ID` to that persisted connection's UUID and
`PAGES_ANTIGRAVITY_CONTEXT_ROOT` to its absolute context directory. The latter
must contain private `home`, `gemini`, `config` and `work` directories. Pages
checks directory ownership, permissions and every ancestor without following
symlinks; a group- or world-writable ancestor is refused. It never copies the
token store. Login, logout and removal of the bound context are not performed
by Pages, and the path is an operator setting rather than client input. Remove
the binding settings to return the connection to its normal managed context.

A terminal `agy` login is not proof of an ACP login: the official adapter owns a
separate auth context. An auth check opens a model-free ACP session in the actual
connection context; a missing token never starts an interactive login. Re-login,
cancellation, expiry and logout apply to that connection alone. Logout requires
the adapter's advertised ACP capability. Pages stores account metadata rather
than provider tokens in DuckDB.

## Models, permissions and lifecycle

The catalog reads ACP model **selectors** and each model's `thinking_level`
choices. Model family IDs may differ from both CLI names and concrete variant
IDs. Pages requires membership and exact confirmation of `model`, the requested
`thinking_level`, and `mode` before sending a prompt. It does not guess a Flash
alias, choose another model or accept a silently remapped effort.

Read-only plans use the adapter's `default` mode with an explicit allowlist of
file-reading and web tools. Shell, writes, browser and delegation are excluded.
Every unexpected permission request is denied. YOLO requires the explicit Pages
YOLO choice and the adapter's `yolo` mode. Local plans require the existing
namespace isolation in both modes. Global MCP, hooks and unreviewed settings are
refused; project hook files are also refused because they can execute outside
the tool permission path.

The adapter supports stdio, HTTP and SSE MCP. Pages offers the tools of a plan
step as an HTTP MCP server (`/api/v1/plan-bridge`) with a step-bound token, so no
separate process is started. Shared ACP launch contracts accept HTTP/SSE entries only when the actual
handshake advertises their transport. Tokens travel through protocol input or
a process environment, never the process argument list.

Plan turns, streaming, continuation, targeted session resume, deadlines,
instance-wide leases and confirmed process cleanup use the shared ACP engine.
Unconfirmed cleanup retains the connection lock. ACP usage is kept as reported;
unreported prices remain unknown and token counts exclude delegated work.

A separate mathematical OpenRouter comparison covers captured ACP usage, with
explicit gaps and subscription charges kept separate. The reduced
implementation, targeted tests and deferred live/historical-price evidence are
documented in [the accounting handoff](../../../docs/PAGE-368.md).

The earlier adapter 1.4.4 reported its own failures (exhausted quota, failed MCP load,
execution error, lost connection) as ordinary agent text and still ends the
turn with `end_turn`. Pages recognizes those fixed wordings, which belong to the
pinned adapter version, and fails the node instead of storing the text as a
model answer. A quota report also carries the reset instant when the adapter
names it, so the plan retry policy can wait. A clean Google API message without
fixed wording cannot be told from model text; it is covered by the model-free
auth check and by the model, effort and mode that are selected and confirmed
before every first and every later prompt.

## Pica

Pica may use this provider (product release of 08.11.2026). A Pica session
runs in the shared ACP engine with the same model, `thinking_level` and `mode`
confirmation as a plan, inside the namespace isolation, and only in "Nur
Lesen"; an agent stored with YOLO is refused, never narrowed. No native tool
is enabled (`enabledTools: []`). The session's one MCP server is Pica's bridge
(`/api/v1/pica-bridge`), which answers MCP with a credential of the job. That
credential lists the Pica catalog and calls a tool only through the binding of
the running turn, so between turns every call is refused, and each call is
authorized again by Pages for the person, the conversation and the turn, like
the calls of the other Pica runners. The credential travels in the
`session/new` input, is masked in recorded output and ends with the job.

In adapter 1.4.4 the lazy MCP dispatcher's server and tool metadata come from
the tool-call argument envelope, so neither that metadata nor the display
title proves that a permission request belongs to Pages. Pica's profile
therefore approves a request only because nothing but the bridge is reachable,
and still refuses every request whose kind belongs to a native tool (`edit`,
`delete`, `move`, `execute`, `fetch`, `switch_mode`). Read-only plans keep
denying such requests. A live check with a real model and an existing sign-in
is part of the acceptance and is not claimed by this description.

## Remote execution

Runner **1.14.0** adds Antigravity inventory and the native ACP worker. The
runner starts the same official entry point as Pages, `agy acp` from a stable
Antigravity CLI **1.5.9** or later, with the connection's Gemini folder,
`--app-data-dir=antigravity-acp`, `--disable-telemetry` and
`AGY_CLI_DISABLE_AUTO_UPDATE=1`. It checks the same sign-in file and the same
configuration rules as Pages; the earlier `agy_acp_server.par` adapter is no
longer started. A local runner finds the managed `agy` generation first on its
search path, also for a native YOLO job. Its dedicated
context defaults to `$PAGES_RUNNER_CLI_HOME/.pages-antigravity` (the runner user's
home when that setting is absent); an explicit absolute
`PAGES_RUNNER_ANTIGRAVITY_HOME` may select another dedicated context. No local
Pages credentials are transferred or private CLI token files copied.

For an operator-managed existing context on the runner host,
`PAGES_RUNNER_ANTIGRAVITY_CONTEXT_ROOT` binds the private `home`, `gemini`,
`config` and `work` directories in place. The runner checks their ownership and
permissions and refuses symlinks or writable ancestors. This setting is local
to the runner process and is never supplied by a plan or a Pages client.
Before entering a user namespace, the runner records the device, inode and mode
of each trusted host ancestor. It compares these identities again inside the
worker, where a root-owned host ancestor may appear with the overflow UID.

New local CLI and script runs and new remote runner jobs use owned PID
namespaces. Their supervisor identities are recorded before a job is released;
the runner keeps its host-side identity outside the job's mount view. Cleanup
records a protected pre-spawn intent before creating the worker; an interrupted
intent or a result without protected ownership evidence retains the reservation.
Only a protected record that the worker was never started can confirm a queued
cancellation without a supervisor.
Cleanup
of an older record without a verifiable boundary remains unconfirmed and keeps
its reservation. A PID, environment tag or process ancestry alone does not prove
that detached children ended. Operators must resolve those legacy records rather
than treating them as clean.

A host must be able to create a bubblewrap PID namespace. The runner proves
this before it admits a job and refuses the job with `cli_isolation_unavailable`
otherwise, without creating a worker; the setup script installs `bubblewrap`,
`curl` and `unzip` and reports whether the namespace works.

The runner rechecks authentication, adapter compatibility, inventory revision,
model and effort at execution time. Pages refuses an older runner, including a
downgrade with retained inventory, without local fallback. Existing job-bound
Pages bridges, result receipts, history, cancellation and process supervision
remain in use. Remote Pica is not introduced.

## Implementation and evidence handoff (15.11.2026)

This handoff follows Igor's reduced completion scope of 15.11.2026. The existing
production implementation is reused unchanged. The source review and targeted
tests below did not establish a production defect requiring a speculative
provider-specific control path. This is not a live-provider acceptance or a
claim that the original universal reliability requirements have been met.

### Implementation reused

| Behavior                   | Existing implementation and meaning                                                                                                                                                                                                                                                                                                                                                                                   |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Start and model selection  | `AntigravityAcpDriver.ts` supplies the official adapter profile, exact model and `thinking_level` selectors, native-tool policy and step-bound Pages bridge. `AcpSession.ts` verifies the handshake and confirms configuration before prompting. No model is hardcoded in the runtime.                                                                                                                                |
| Assigned TODOs             | `backend/service/agents/AgentPlanStepProgressService.ts` initializes ticket criteria and instruction checkboxes before dispatch, stores `update_step_progress` immediately, and retains completed work only within the matching iteration and ticket scope. Ticket completion uses the revision-protected checklist service.                                                                                          |
| Structured agent TODOs     | `AcpSession.ts` forwards ACP updates to `backend/service/agents/sessions/AgentSessionRecorder.ts`. The recorder journals structured `plan` entries; `backend/database/repositories/agent/AgentSessionRepository.ts` projects them into `agent_plan_agent_todos`. `backend/service/agents/AgentPlanAgentTodoService.ts` looks up each node/loop iteration by its attempt ID. Free text is never inferred to be a TODO. |
| Run panel                  | `backend/service/agents/AgentPlanRunReader.ts` combines authorized checklist observations, explicit progress and agent TODOs. `app/components/agents/plans/plan-agent-todo-model.ts` combines those lists for the counter and visible TODOs. `use-plan-poll.ts` polls active runs at a nominal two-second interval while the tab is visible; that interval does not establish a two-second end-to-end guarantee.      |
| Pause and continue         | `backend/service/agents/AgentPlanRunCommands.ts` journals `pausing`, gates waiting steps and aborts starts that have not dispatched. Already dispatched work is allowed to settle before `paused`. Resume requires a persisted pause boundary and no active controllers, adopts the continuation and schedules pending work. It does not immediately freeze a running provider prompt.                                |
| Stop                       | The same command service journals the stop before aborting owned executions. `AcpSession.ts` and `backend/agents/cli/CliSessionCloseout.ts` finish the session and check cleanup. Unconfirmed cleanup retains reservations; the mocked tests below cannot establish that real descendants were removed.                                                                                                               |
| Authorization and controls | `backend/service/agents/AgentPlanService.ts`, `AgentPlanControlService.ts` and `AgentPlanControl.ts` enforce current plan rights, run ownership/administrator access and durable action availability for every provider. The frontend consumes these server-derived controls.                                                                                                                                         |

### Targeted evidence in this change

The following evidence describes an earlier revision. The named test files and
frontend configuration were removed; the commands are historical, not current
instructions or evidence for this checkout.

The ACP test adapter now identifies its Antigravity flavor as
`antigravity-acp 1.4.4` by default instead of incorrectly presenting the Codex
identity (`tests/backend/backend/agents/acp/fake-acp-adapter.ts`). The existing
`acp-lifecycle.unit.test.ts` matrix now includes Antigravity: 13 additional
synthetic cases cover protocol closeout, uncertain cleanup, cancellation,
deadlines, crash classification, missing login/MCP, stop reasons and progress.
Crash expectations preserve the intentional Antigravity rule that raw stderr
does not enter the session history; the Codex/Claude expectations remain.

`acp-harness.ts` exposes the activity observer. One additional case in
`group-continuation.unit.test.ts` proves that Antigravity's structured plan
reports its active TODO before the prompt ends, excluding completed/pending
entries from the active titles. Existing cases also confirm model/low effort
selection again on the next turn and detect adapter-reported MCP failure.
These are scripted ACP sessions with an in-memory adapter, not Gemini calls.

Executed locally on 15.11.2026, with coverage explicitly disabled:

```sh
NODE_ENV=test pnpm exec vitest run --config vitest.backend.config.ts --coverage.enabled=false \
  tests/backend/backend/agents/acp/antigravity-contract.unit.test.ts \
  tests/backend/backend/agents/acp/acp-lifecycle.unit.test.ts \
  tests/backend/backend/agents/acp/group-continuation.unit.test.ts \
  tests/backend/backend/service/agents/page358-todos.unit.test.ts \
  tests/backend/backend/service/agents/agent-plan-service-control.unit.test.ts \
  tests/backend/backend/service/agents/page174-branching-pause.unit.test.ts

pnpm exec vitest run --config vitest.backend.config.ts --coverage.enabled=false \
  tests/backend/backend/service/agents/page84-run-checkpoints.unit.test.ts \
  -t 'preserves live pause/resume semantics|an explicit stop'

NODE_ENV=test pnpm exec vitest run --config vitest.frontend.config.ts --coverage.enabled=false \
  tests/frontend/app/components/agents/plans/page358-todo-count.unit.test.tsx \
  tests/frontend/app/components/agents/plans/use-plan-control.unit.test.ts
```

| Selection                     | Result and scope of proof                                                                                                                                                                                                                                         |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Six Backend files             | **88 passed**. Antigravity registration/lifecycle/continuation plus shared TODO initialization, ticket writes, iteration separation, completion retention, authorization and branching pause behavior. Shared tests do not represent an Antigravity provider run. |
| Two selected checkpoint cases | **2 passed, 6 intentionally unselected**. Pause waits for dispatched work, resume preserves its result without replay and rejects a competing resume; Stop cancels successors and prevents in-place resume. Execution and persistence boundaries are stubbed.     |
| Two Frontend files            | **7 passed**. Combined TODO counts/marks update on rerender; the control hook uses polled server state and requests refresh. No real browser, API or database was exercised.                                                                                      |

The first six-file Backend run was 87/88 because its shared crash assertion
expected raw stderr for Antigravity. That assertion was corrected to verify
the existing privacy behavior; the final six-file run passed 88/88. The first
Frontend invocation inherited production mode and failed all seven cases at
`React.act is not a function`; the explicit `NODE_ENV=test` rerun passed 7/7
without changing application code or test infrastructure.

### Known limits and explicitly deferred evidence

- Pause is a scheduling boundary, so a slow or hung dispatched prompt can keep
  the run in `pausing`. Immediate provider suspension and a fixed pause deadline
  are not implemented or claimed by this handoff.
- Continuing an open native session is distinct from resuming after adapter or
  server exit. Native recovery depends on advertised capabilities and retained
  evidence. The documented remote Antigravity path offers no native resume
  (`backend/service/agents/PlanRetries.md`); after observed tool activity a new
  session is not silently substituted. Universal restart/session preservation
  is not established.
- Native TODO projection is bounded to 40 entries and 200 characters per entry.
  A failed TODO projection is logged after the journal commits and does not fail
  that append (`AgentSessionRepository.keepAgentTodos`); the run panel can then
  retain an older list. No recovery or latency guarantee for that case is added.
- Explicitly **deferred, not passed**: live `gemini-4-hydrogen` with reasoning
  `low`, a two-second live-panel guarantee, fixed Pause/Stop time guarantees,
  complete real-process and state acceptance, repeated pause/continue cycles,
  restarts, and UI/MCP/database agreement for every state. No new provider run,
  disposable instance or live credential/data access was used for this ticket.
- Token and cost accounting is described in the accounting handoff. No additional production defect
  was reproduced within this source review and mocked-test scope; that is not
  evidence that none exists in a live provider environment.
- Lint, Check, typecheck, formatting checks, build, full suites and coverage:
  **an die Abschluss-QA übergeben**; none was executed for this handoff.

T1 is evidenced by the implementation map, the four changed ACP test files and
the actual targeted results above. T2 is evidenced by the explicit limits and
deferred cases in this section. K1 is fulfilled by these workspace artifacts
and their reproducible commands; business acceptance remains with the reviewer.
