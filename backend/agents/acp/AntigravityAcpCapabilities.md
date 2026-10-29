# Google Antigravity ACP

Pages runs the official `antigravity-acp` adapter, not an `agy --acp` command.
The reviewed registry release is **1.4.4**. Managed Linux x64/arm64 installations
verify the registry SHA-256 before extracting `agy_acp_server.par` and its
adjacent `localharness_external`. Both files belong to one immutable tool
release. Installation, updates and rollback use Settings → Agents → Tools;
a running session keeps its pinned release.

Sources: [ACP registry](https://github.com/agentclientprotocol/registry/blob/main/antigravity-acp/agent.json),
[official setup](https://antigravity.google/docs/ide/extensions/zed/).
The shipped adapter's protocol implementation defines the selectors and OAuth
callback contract described below.

## Connections and authentication

Add Google Antigravity under the existing local/CLI connections. Each connection
has its own `GEMINI_HOME`, separate from the service user's personal CLI state.
The `oauth-personal` ACP method opens Google's authorization page and owns an
HTTP callback on `127.0.0.1` with a random port. Pages presents the protected URL
through the existing login polling resource. There is no device code or pasted
Google password. The browser must reach that loopback callback at the execution
host, for example through an operator-managed tunnel when appropriate. Pages
does not rewrite Google's redirect URI or relay authorization codes.
Antigravity's metadata and login probes require Linux bubblewrap with an owned
PID namespace. Once the namespace supervisor exits, its descendants are gone;
Pages does not inspect other processes' environments for those probes. Plan
sessions already require that same namespace boundary.

The Pages MCP readiness probe also runs in its own PID namespace. A confirmed
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

The adapter supports stdio, HTTP and SSE MCP. Pages retains its existing scoped
stdio Pages-MCP bridge, so no additional listener or persistent HTTP token is
needed. Shared ACP launch contracts accept HTTP/SSE entries only when the actual
handshake advertises their transport. Tokens travel through protocol input or
a process environment, never the process argument list.

Plan turns, streaming, continuation, targeted session resume, deadlines,
instance-wide leases and confirmed process cleanup use the shared ACP engine.
Unconfirmed cleanup retains the connection lock. ACP usage is kept as reported;
unreported prices remain unknown and token counts exclude delegated work.

Adapter 1.4.4 reports its own failures (exhausted quota, failed MCP load,
execution error, lost connection) as ordinary agent text and still ends the
turn with `end_turn`. Pages recognizes those fixed wordings, which belong to the
pinned adapter version, and fails the node instead of storing the text as a
model answer. A quota report also carries the reset instant when the adapter
names it, so the plan retry policy can wait. A clean Google API message without
fixed wording cannot be told from model text; it is covered by the model-free
auth check and by the model, effort and mode that are selected and confirmed
before every first and every later prompt.

**Pica remains unavailable for this provider** until the complete restrictive
tool boundary is verified with a real model. The catalog and chat execution both
refuse this path, with an explicit reason. Plan availability is insufficient to
enable Pica. In adapter 1.4.4, the lazy MCP dispatcher's server and tool
metadata come from the tool-call argument envelope. That metadata and the
display title are therefore not an independent proof that a permission request
belongs to Pages. Read-only plans deny such requests; they cannot currently use
Pages MCP tools through this permission path. An ACP transport capability alone
does not establish that authorization boundary.

## Remote execution

Runner **1.14.0** adds Antigravity inventory and the native ACP worker. The host
must provision the same official adapter pair on its runner PATH. Its dedicated
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
