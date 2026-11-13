# Agent tools and runtime

[Documentation index](README.md). Optional CLI installation, scheduling and
troubleshooting. Basic project/wiki development needs neither model credentials
nor a native agent. For current memory limits see [Worker memory](AgentWorkerMemory.md).
Version-specific provider behavior below retains its original verification
boundaries; moving the text does not constitute a new provider test.

- [Agent Tool & Runtime Manager (PAGE-69)](#agent-tool--runtime-manager-page-69)
- [Native ACP resource scheduling (PAGE-81)](#native-acp-resource-scheduling-page-81)
- [Limited worker units (PAGE-127)](#limited-worker-units-page-127)
- [OpenCode plan nodes with a Console / Zen key (PAGE-66)](#opencode-plan-nodes-with-a-console--zen-key-page-66)
- [ACP adapters for the CLI runners](#acp-adapters-for-the-cli-runners)

## Agent Tool & Runtime Manager (PAGE-69)

**Settings → Agents → Tools** is available only to an active personal system
administrator in admin mode. Every loader and action rechecks persisted rights;
mutations also require the same origin. Status reads poll cached metadata and
never install or execute tools. Opening a page is not a model test.

The fixed registry manages Codex CLI **0.160.0**, Claude Code **2.1.322**
(rollback also accepts **2.1.293**; Fable 5.2 needs 2.1.321 or later),
OpenCode **1.18.34**, Codex ACP **2.2.2** (adoption also accepts **2.1.1**), and
Playwright MCP **0.0.83**. Playwright MCP itself pins
`playwright@1.64.0-alpha-1790635538000`; its browser revision is used for Chromium
and optional Firefox. The selected versions were checked against the actual
npm registry. The existing protocol-driver ranges remain available to standalone
consumers. There are no new Pages library dependencies.

Tools, npm cache, probe home, enablement and release pointers live in
`<directory containing config.toml>/tools/`. Saved connection credentials remain
in the existing data directory. The service account needs write access to this
instance-owned tools directory, a supported Node/npm installation and outbound
access to the official npm registry and Playwright browser CDN. It receives no
additional host privileges. npm dependency scripts are disabled; the fixed
Claude/OpenCode package setup scripts run separately in the private home.

Each install, repair and update creates a separate generation and verifies it
before an atomic activation. Failed candidates are discarded; the previous
working release and login files stay intact. Explicit rollback health-checks the
previous generation before publishing it. An update already at its approved
target is a no-op. Active sessions keep their original paths; removal is blocked
while a session, login, text request, probe or uncertain cleanup uses the tool.
Old generations remain until an explicit managed removal; operators should
monitor disk usage. Removal affects only the selected tool's managed directory,
never system packages or logins. A required removed tool is installed again on
its next use. At startup, managed tools can automatically move to a newly
reviewed registry target after a successful probe. An explicit rollback records
that target and remains in place across restarts until a different target is
reviewed. Compatible adopted system tools remain untouched by automatic updates.
Admins can also trigger an update explicitly. There is no periodic registry
polling; adding an approved target is a reviewed source change, with no
uncontrolled major upgrade.

New calls resolve a CLI in one order: the activated managed generation
(`tools/<tool>/active.json`), otherwise a system installation from the service
PATH whose real path passes the trust check and whose version is on the
allowlist. Login, status check, model catalog, CLI test and new plan or ACP
sessions all start the generation this check returned; ACP receives it as
`CLAUDE_CODE_EXECUTABLE` or `CODEX_PATH`, and a running session keeps the file
it pinned. Each activation and rollback of Claude Code also points the stable
link `tools/claude/bin/claude` at the active generation, so an operator's
terminal that starts this path runs the same installation as Pages. The Tools
card names the executable of new calls, the rollback generation and whether
the terminal entry is current; versions there and in connection checks are the
results of the check shown with its time, not a new call (PAGE-293,
[docs/PAGE-293.md](PAGE-293.md)).

After listening, Pages reconstructs required dependencies from active CLI
connections and saved optional integrations in the background. It checks local
sign-ins without a model request. Other Pages features remain available while
optional checks fail. Native runs wait for readiness, including an executable
CLI, approved adapter, workspace, functional bubblewrap and required browser
components. The existing ACP handshake still confirms the exact model, effort
and permission mode before the prompt. No provider, model or runner fallback is
introduced. Readiness failures appear in run events and the Tools inventory.
A local sign-in check cannot establish remote subscription entitlement or token
validity; the existing model test remains an explicit operation.

Playwright requires both **Enable integration** on its Tools card and **Allow
Playwright browser tools** in the agent's YOLO configuration. Read-only agents
and Pica receive no browser grant. Group members must agree on this permission.
Chromium is provided proactively; MCP runs headless with an isolated profile,
keeps its sandbox enabled, saves sessions and screenshots under the workspace's
`.pages-artifacts/<session>/`, and inherits the existing process ownership tag.
Use a separate authorized test instance and test data. Playwright's URL filtering
is not treated as a security boundary. Firefox can be provisioned and tested,
but plan sessions currently select Chromium.

A model-free health check initializes ACP without creating a session; Playwright
MCP initialization also confirms a nonempty tool catalog. Authorized session
startup and the existing MCP readiness machinery perform the later
credential-scoped checks of the plan bridge. Browser checks actually launch/close a headless browser;
bubblewrap checks actually create a namespace. Installed, ready and running are
separate inventory facts. Checks have bounded deadlines; they expose safe
structured diagnoses, never raw npm output, prompts or secrets.

### Linux provisioning and container deployment

Node **>=22.22.0** is a prerequisite for Pages itself. Node must be supplied by the
operator from a trusted distribution. Pages cannot replace the runtime of
its own running process. npm must be available on the service PATH. Bubblewrap
and browser system libraries require a separate authorized host setup; the web
process never runs a host package manager or changes kernel/security policy.

`scripts/provision-agent-tools.sh` prints a fixed reviewed package plan by
default for Debian 12 and Ubuntu 24.04. Only an operator's explicit `--apply`
invocation in a privileged setup context installs these OS packages. Review it
before use. Unsupported distributions stop with a diagnosis and require their
own authorized OS provisioning. The script is never called from the UI. After
provisioning, run **Test functionality** as the ordinary Pages service account.
A binary alone does not establish working namespaces or browser libraries.

No Docker deployment was previously supplied by this repository. For a custom
container image, install these OS libraries at image build time (for example in
a supported Debian-based official Node image), then switch to a non-root runtime
user. Pin and verify the chosen base image digest in the deployment. Persist the
instance directory, including `tools/`, the main configuration, data, instance
secret and saved logins; preserve ownership and never copy credential directories
into the image. Mount workspaces separately from instance data. The runtime
container must support the existing unprivileged bubblewrap and browser
sandboxes; restricted environments produce a readiness refusal. No privileged
container, disabled seccomp profile or sandbox bypass is a supported repair.

On new installation, configure the instance and its CLI connections normally;
startup/preflight supplies approved managed packages. After restart, persisted
release pointers are checked and reused rather than installed globally. After a
Pages update, startup can apply newly reviewed registry targets; review these
changes before deployment and use controlled Update/Rollback when needed.
For read-only/offline hosts, provision compatible trusted system tools or populate
the instance's managed tools in an authorized connected staging environment and
verify health on the target. Missing npm, network access, write permissions,
external Claude ACP, system libraries or namespaces remain concrete operator
diagnoses. Cleanup uncertainty stays pinned by the existing ACP recovery journal
and blocks destructive maintenance until a later startup confirms cleanup.

## Native ACP resource scheduling (PAGE-81)

One instance-wide `AcpResourceScheduler` admits Codex (`codex-acp`),
Claude Code (`claude-agent-acp`) and native OpenCode (`opencode acp`). The existing DAG still determines which
steps are executable. ACP admission has a separate shared FIFO queue; queued
steps have no native ACP process and do not occupy the DAG's two non-ACP
execution slots. API work retains its existing request execution path.

Optional flat keys in the instance's `config.toml` (manual edits apply after restart):

```toml
maxConcurrentAcpSessions = 2  # 0–999; 0 = unlimited up to the absolute ceiling of 999
memoryAwareScheduling = true
minimumAvailableMemory = 2048 # MiB, Linux MemAvailable
queueDiscipline = "fifo"
```

`PAGES_MAX_CONCURRENT_ACP_SESSIONS`, `PAGES_ACP_MEMORY_AWARE` (`true`/`false`
or `1`/`0`) and `PAGES_ACP_MIN_AVAILABLE_MEMORY_MB` override the first three
settings. Invalid settings refuse startup. With memory checks enabled, a
missing measurement or RAM below the reserve blocks new starts. Waiters are
rechecked every second without another user action. The reserve is a start
threshold, not a prediction of a model's future consumption.

Without an explicit concurrency setting the default is **2**; an existing saved
value, including **1**, is preserved. In **Settings → System → ACP resources**,
an active administrator in admin mode can save a whole number from **0 to 999**.
The change is persisted to the instance configuration and applied to the shared
Pica/Agent Plans scheduler immediately. Raising the limit wakes eligible FIFO
waiters without resubmission; lowering it preserves every occupied lease and
waiter. **0** displays as **Unlimited (max. 999)** and keeps RAM, cleanup and
recovery checks active. The ceiling does not imply hardware capacity for 999
processes. When `PAGES_MAX_CONCURRENT_ACP_SESSIONS` controls admission, the card
shows that source and disables edits; direct form submissions are refused too.

Starting, running, paused-but-existing, idle and uncertain native sessions
all occupy capacity. A PostgreSQL lease is committed before the first start
operation and removed only after confirmed process-tree closeout. Group
continuation uses the original lease and native process. Paused waiters keep
their FIFO position among eligible requests; pausing never frees a live lease.
Cancelling a queued node removes it without starting its adapter. Node deadlines
include waiting time.

Pages never closes a native session because it is idle. A session ends with
its plan run or Pica job, on Stop, at shutdown, or when its process exits. Since
an idle session keeps its slot, a run that retains sessions needs a limit above
the sessions it keeps open at once; otherwise its next start waits for capacity
until someone stops a run or raises the limit. A
follow-up started by the adapter through steering is active work, so it remains
under the owning job deadline until Pages closes it or starts the next prompt.
When a process exits on its own, the run record receives the reason and closing
outcome; continuing that session fails with `plan_context_changed`, and Pages
does not silently start a replacement or replay accepted steps. A failed or
unconfirmed cleanup continues to occupy capacity, visibly.

At startup Pages cleans durable leases before admitting work, including a
crash between reservation and recording the process start. Existing run recovery
marks interrupted work failed and never retries it. Interrupted sessions from
before this journal existed are adopted from active runs and retained workspace
reservations, so an upgrade also accounts for their cleanup failures. Shutdown cancels waiters,
drains runs and closes native sessions; a run that the shutdown ends is
recorded as interrupted, not as stopped by its executor, so it can be resumed
after the restart (PAGE-127). Cleanup uses the inherited
`PAGES_RUN_INSTANCE` tag, also for helpers outside the adapter's process group;
an unreadable process scan cannot prove absence. Unresponsive process exit
returns an unconfirmed closeout after bounded waits. Cleanup failures and
uncertain journal writes fail closed; retained leases are retried during the
next normal startup. While a request waits only because uncertain leases hold
the capacity, Pages checks them again at most once a minute by their own
instance tag and worker unit and releases each one whose processes are proven
gone (PAGE-127); an unconfirmed lease keeps its capacity. There is no
force-release UI.

The shared **ACP resources** card in Settings → System
polls `/agent-api/resources` every five seconds while open and refreshes after
a confirmed limit change. It shows global occupied leases, the effective limit,
its source and the combined Pica/Agent Plans queue.
The endpoint rechecks an active personal administrator in admin mode on every
request and uses `no-store`. It shows occupied sessions, waiting reasons,
current available RAM, paused blockers and failed cleanup, and names each
credential leftover whose cleanup the last start could not confirm, with what
clears it. It exposes no prompts, workspace paths, credentials or native
conversation identifiers.

This scheduler uses the Pages runtime and PostgreSQL. The native resource
scheduler is independent of any future workflow orchestration.

## Limited worker units (PAGE-127)

Every ACP worker — the adapter, its CLI runner and every
helper they start — runs inside the bubblewrap namespace **and** in a
transient unit of the server account's systemd user manager, named
`pages-acp-<instance>-<random>.service` in `pages-acp.slice`. The unit is a
cgroup of its own with hard limits:

| Limit | Value | Why |
| --- | --- | --- |
| `MemoryMax` | infinity per worker | shared slice budget: 10G; see [Worker memory](AgentWorkerMemory.md) |
| `MemorySwapMax` | infinity per worker | shared slice budget: 2G |
| `OOMScoreAdjust` | 500 | prefer workers under host memory pressure |
| `TasksMax` | 512 | processes and threads of the whole worker tree; measured ≤ 100 |
| `CPUQuota` | 200 % | at most two of four cores |
| `RuntimeMaxSec` | node deadline + 120 s, else 24 h | a backstop if Pages itself hangs |
| `OOMPolicy=kill` | — | an exceeded limit ends the whole worker, inside its cgroup only |

The shared slice budget and OOM behavior are described in
[Worker memory](AgentWorkerMemory.md), the current authority for memory limits.
Worker failures remain visible as `acp_worker_limit`.
A worker whose output holds a line longer than 4 Mi characters, with or
without a line break, is ended the same way: the line and everything after it
are discarded, and the job fails with `acp_output_overflow` instead of
continuing on a truncated or oversized frame.
The other direction has the same 8 MiB limit (PAGE-295): every ACP message
Pages sends is measured as the complete serialized JSON-RPC line, including
the instruction, the file labels, escapes and the Base64 of inline images.
The instruction and the complete file inventory come first; a file content is
inlined only while it fits completely, and every other file is marked as not
inline and reached through its verified original copy in the session. A
message whose instruction and inventory alone do not fit is never written and
fails with `acp_input_too_large`, which is not repeated automatically.
Values reach the worker through a 0600 environment file in
`<data>/worker-units/`, removed once the worker started, never through an
argument list. The manager's own variables — session bus, SSH and GPG agents,
runtime directory — are removed, and the namespace hides `/run/user/<uid>`,
so no socket of the account's service manager, desktop bus or SSH agent is
reachable from inside. Stop, timeout and cleanup signal the unit by its name,
which carries the session's random instance tag: ownership is the unit's
cgroup, never a process ID, and helpers that left the process group are
included.

Pica never starts without a unit (`acp_worker_unit_unavailable`, no model is
called). Plan nodes use the unit wherever the service manager provides one and
otherwise start as before, with one warning. The unit works the same whether
Pages runs as a system or as a user service, because the user manager starts
the process itself; the server account needs a running user manager
(`loginctl enable-linger <account>`), reached through `/run/user/<uid>/bus`.
`systemctl --user list-units 'pages-acp-*'` lists the live workers.

**Historical DuckDB diagnosis (PAGE-127):** the following describes an older
release, not a repair for the current PostgreSQL server. When DuckDB reported
that a fatal error invalidated the open database, Pages
ends with exit code 1 (`database_invalidated`) instead of answering without a
usable database; the service manager starts it again and the startup recovery
records interrupted runs as resumable. Observed in PAGE-127 only after hard
kills of a test instance (`Failed to delete all rows from index` on
`chat_sessions`); rebuilding the affected index (`DROP INDEX … ; CREATE INDEX
…; CHECKPOINT;` with the server stopped) repaired the file.

## OpenCode plan nodes with a Console / Zen key (PAGE-66)

Pages manages the verified native OpenCode **1.18.34** under the instance's
`tools/` directory. Create an active OpenCode connection or use **Settings →
Agents → Tools → Install**. No global npm installation or separate OpenCode ACP
adapter is needed. A compatible trusted system installation can be adopted;
otherwise Pages installs its approved version locally. The service needs Node
and npm from operator provisioning; a login shell's nvm setup alone does not
configure a systemd service.

Both OpenCode plan modes require Linux bubblewrap at `/usr/bin/bwrap` and working
unprivileged user namespaces for the service account. Install it through the
host's package manager (`apt install bubblewrap` on Debian/Ubuntu). A file-only
installation check does not prove that namespaces work: Pages performs its
existing isolated probe on an actual start. `PAGES_CLI_ISOLATION=required` also
makes isolation mandatory for the other CLI paths. Register an authorized
workspace, optionally narrow its roots with `PAGES_WORKSPACE_ROOTS`, and provide
the instance URL as for the other ACP runners.
OpenCode's native internal HTTP listener uses loopback, an ephemeral port and a
fresh process password. No fixed OpenCode server or IDE session is reused.

In **Settings → Agents**, create an **OpenCode** connection, select
**OpenCode Console / Zen (opencode)** in its key form and enter the key obtained
from OpenCode Console / Zen. No Codex or Claude login and no OpenRouter key is
required. For an OpenRouter key, explicitly select **OpenRouter (openrouter)**.
The destination is never guessed from a key's prefix. A provider change requires
explicitly saving that provider with its matching key; old model IDs remain
unchanged and must be reselected explicitly when they no longer match.

The inspected package identifies Zen as provider **`opencode`**, with native
API credentials shaped as `{"opencode":{"type":"api","key":"<redacted>"}}`;
OpenRouter uses the distinct `openrouter` entry. This is confirmed by the
installed binary and the versioned [native auth source](https://github.com/anomalyco/opencode/blob/v1.18.34/packages/opencode/src/auth/index.ts)
and [provider source](https://github.com/anomalyco/opencode/blob/v1.18.34/packages/opencode/src/provider/provider.ts).
New keys are stored in
`<data>/agents/<connection-id>/opencode/opencode/auth.pages.encrypted`, with
owner-only directories and file mode 0600. The existing `InstanceSecretCipher`
uses AES-256-GCM and binds the encrypted native JSON to the connection ID. Back
up the existing instance secret with the data; another instance cannot decrypt
this file. OpenCode receives the JSON only through `OPENCODE_AUTH_CONTENT` in
its isolated child environment, never through arguments or the prompt. Pages
does not require an `OPENCODE_API_KEY` in the service environment. Known runtime
keys, MCP tokens and the process password are redacted before run persistence.

Existing native `auth.json` files remain readable with their original provider;
they are not reinterpreted or automatically migrated. Replacing a key through
the form writes the encrypted file atomically and removes the old plaintext
file. Removing the connection or logging out removes both formats. The local
access check confirms version, decryption and credential structure; it does not
prove remote key validity or available credits. The existing explicit **model
test** makes a provider request and may incur usage. Merely opening Settings
starts neither a CLI nor a model request.

The connection loads `opencode models <configured-provider> --verbose`. Catalog
entries keep the complete provider-prefixed ID: `opencode/<model>` for Zen,
`openrouter/<vendor>/<model>` for OpenRouter. Models and reasoning variants come
from this native catalog; no OpenRouter catalog is used to validate a Zen key.
The catalog lists provider capabilities, not a promise of account entitlement or
balance. The ACP session must offer and confirm the exact saved model, variant
and managed mode before receiving the resolved `AGENT.md`, node instruction,
parameters and Pages contract. Undeclared or remaining parameter placeholders
refuse the node. A leading slash in the agent text is sent as part of a Pages
assignment, so it cannot turn the whole plan prompt into a native slash command.
Internal helper and subagent models are pinned to the same model and variant;
there is no alternate model or `opencode run` fallback for plan steps.

OpenCode offers exactly the saved modes **Read only / Nur Lesen** (`read_only`)
and **YOLO** (`yolo`). Missing run options mean Read only. A saved
`workspace_write` configuration stays unchanged and cannot start until someone
chooses a mode; it is never promoted to YOLO. Read only uses native deny rules
for edits, commands, delegation and other changing tools, plus a read-only
workspace mount. Its Pages credential offers only reading operations and the
server checks every call. YOLO enables all tools available in native ACP and
the complete Pages tool catalog authorized for the executor, without an extra
tool allowlist or user approval loop. Native explicit deny rules still apply;
Pages retains the explicit `*.env` and `*.env.*` read denials. Unexpected ACP
permission requests are refused in Read only and automatically approved in
YOLO only when an allow option exists. User/project OpenCode configuration,
external skills, default plugins, sharing and updates stay disabled or are
refused by the existing configuration guard. Pages installs no foreign plugin
or MCP server. Workspace, connection, project and Pages authorization boundaries
remain in force. Pica keeps its existing, narrower Pages-only profile.

The run records requested and confirmed model/variant, native mode, workspace,
effective permission rules, tool events, final answer, ACP session ID and process
closeout. OpenCode 1.18.34 reports the configured model selector, but no separate
provider-response model identity; `modelVerification` makes that limit explicit.
Its ACP registration path also lacks a verified model-free MCP readiness command;
Pages does not invent a connected status. Tool failures and acceptance remain
observable, and a real authorized Pages tool call is still part of manual
functional acceptance.

Native authentication failures, exhausted balance/quota, rate limits, unavailable
models, permission denial and generic ACP failures have distinct safe error
codes when OpenCode reports recognizable diagnostics. Unknown provider messages
remain a generic ACP failure without raw upstream text. Timeout and user stop
close the ACP channel and end only this task's tagged process group and helpers.
An uncertain cleanup keeps the native lease, connection mutation lock and
workspace reservation; retry occurs during normal startup recovery, with no
force-release UI. Other OpenCode/IDE sessions are never selected by name.
OpenCode nodes require a valid, completed `pages-report` and accepted business
progress as well as regular ACP completion and confirmed cleanup.

PAGE-66 validation inspects local version and release source and runs the static
Pages gates. It deliberately starts no server, model request or agent run and
adds no automated tests. Credentialed end-to-end behavior, account-specific
models, live MCP calls, cancellation and native tool effects remain for manual
functional acceptance.

## ACP adapters for the CLI runners

A Codex connection uses the instance-local Codex CLI and ACP adapter managed by
**Settings → Agents → Tools** (PAGE-69). Startup and native session preflight
install or repair approved missing dependencies; neither requires a global npm
installation. Compatible system tools under trusted system/Node installation
paths can be adopted. The manager's exact allowlist is narrower than the ACP
protocol driver's historical compatibility range below.

The existing Claude ACP adapter remains an externally provisioned dependency;
PAGE-69 adds no new Claude/OpenCode adapter. Pages continues to start its process
for each authorized session and use the connection's isolated sign-in.

| Runner      | Package                                  | Executable         | Pages accepts   | Verified with |
| ----------- | ---------------------------------------- | ------------------ | --------------- | ------------- |
| Codex CLI   | `@agentclientprotocol/codex-acp`         | `codex-acp`        | 2.1.1 up to 3.0 | 2.2.2         |
| Claude Code | `@agentclientprotocol/claude-agent-acp`  | `claude-agent-acp` | 0.90.x          | 0.90.0        |

For the external Claude adapter only, an operator can install the fixed package
into a dedicated directory owned by the service account and add its `.bin`
directory to the service PATH:

```sh
npm install --prefix /srv/pages-external-acp @agentclientprotocol/claude-agent-acp@0.90.0
# Add /srv/pages-external-acp/node_modules/.bin to the Pages service PATH.
```


The adapter packages a Claude CLI binary of its own, which Pages never uses:
it always points the adapter at the `claude` CLI of the host
(`CLAUDE_CODE_EXECUTABLE`), so the sign-in, the version and the catalog the
other Pages checks use are the ones the node runs with. The external Claude adapter is only
found when its folder is on the `PATH` of the running server; the service
needs no restart after installing it, because the executable is looked up at
every node start. Previews and other majors are refused. A 0.x adapter may
change with every minor version, so Pages accepts the next one only after it
was verified.

What Pages sets for a session, and nothing else:

- **Codex:** `CODEX_PATH` (the Codex CLI of the connection), `CODEX_CONFIG`
  (sign-in method, provider, shell and web switches of the mode),
  `INITIAL_AGENT_MODE`; the session mode `read-only` or `agent-full-access`,
  the model and the effort are confirmed before the prompt.
- **Claude Code:** `CLAUDE_CODE_EXECUTABLE`, the automatic model fallback and the
  remap of retired model names switched off, auto memory off; `session/new`
  carries the Claude options (`settingSources: []`, `strictMcpConfig`, the
  tool allowlist of Read only). The mode `default` or `bypassPermissions`, the
  model and the effort are confirmed before the prompt; the model the adapter
  reports with its first usage update must equal the stored one.

Check an installation, as the account of the Pages server and from the folder
of the repository, with a throw-away workspace:

```sh
pnpm acp:smoke --provider claude_code --data ~/.pages/data \
  --connection <connection id> --workspace /tmp/smoke-workspace \
  --mode read_only --model <exact model id> --effort low
```

It starts the node exactly like a plan does (connection sign-in, adapter,
isolation, mode), sends a short prompt and prints what the run record would
hold: adapter and model as reported, session mode, events, closing report and
whether any process of the session is left. `--stop-after <seconds>` stops the
node like the stop button and `--timeout <minutes>` applies a deadline. The
session has no Pages tools: the plan bridge accepts only the bearer of an
active step, which exists only in the memory of the running server.

YOLO needs [bubblewrap](https://github.com/containers/bubblewrap)
with working unprivileged user namespaces for the server
account. The managed production path now requires it for every native ACP
session; a failed readiness check reports the tool and cause through
`agent_tool_not_ready`. Low-level standalone smoke runs still report
`plan_yolo_isolation_unavailable` for YOLO
before any process starts. Pages probes the isolation again a minute after a
failed probe, so installing bubblewrap needs no restart either.

Shared run notes have been removed (PAGE-80). Plan runs do not create notes
directories, step files or pause markers and do not add notes instructions or
filesystem access. Existing `{{@run.notes}}` occurrences in agent templates or
node instructions are reported as unsupported; their text is never replaced
or silently edited. Remove or revise them explicitly before starting a run.

Old directories under `~/.pages/temp/<planId>/<runId>/`, their contents and
sibling `<runId>.paused` markers remain untouched. Pages no longer cleans them
up automatically. Any later deletion requires separate operator approval.
Prompt and final-answer archiving keeps its existing behavior.

| Run record or error                                      | Cause and remedy                                                                 |
| -------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `agent_tool_not_ready` | The run events name a tool and concrete readiness cause; inspect Settings → Agents → Tools. |
| `plan_acp_adapter_missing`, `plan_claude_acp_adapter_missing` | Check the managed Codex installation, or the externally provisioned Claude ACP adapter. |
| `plan_acp_adapter_unsupported`, `plan_claude_acp_adapter_unsupported` | The run record names the installed adapter and the verified range. |
| `plan_yolo_isolation_unavailable`                        | bubblewrap is missing or user namespaces are off. Install or allow it.           |
| `plan_permission_mode_unenforceable`                     | The adapter did not offer or confirm the mode, for Claude Code for example a managed setting that disables `bypassPermissions`, or a server running as root. |
| `plan_model_unavailable`, `plan_reasoning_unsupported`   | The runner does not offer the stored model or effort. Choose another in the agent. |
| `codex_permission_mode_required`, `claude_permission_mode_required` | An agent saved with the earlier write mode needs a chosen mode.   |
