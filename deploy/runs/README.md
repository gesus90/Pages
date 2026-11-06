# Standalone plan engine

`node pages-runs.mjs --config /absolute/config.toml` starts the plan scheduler
from the same versioned server artifact as the API. It opens no application
HTTP listener. PostgreSQL and the instance's persistent configuration, payload
files, agent definitions and native-owner directories are shared with the API.
Use the same operating-system user for both services and its existing native
agent user manager. The API applies numbered migrations before the first start
of a new worker version; the worker does not migrate the database.

The configuration key `runsMode = "separate"` selects the standalone worker.
Omitting the key, or setting `runsMode = "server"`, preserves the embedded engine.
The two modes use the same database advisory ownership lock, so a second engine
fails to start. Ownership loss terminates the owner before further scheduling.
A partially initialized owner exits rather than constructing a second service
graph on an initialization retry. Changing modes requires stopping the former
engine owner before starting the new one.

In separate mode, the API authorizes and prepares a request, then commits the
run/snapshot, reservations, command and any MCP operation journal together.
Start, pause, stop and resume return a `command` receipt with an identifier,
action and acceptance time. `accepted` confirms persistence; `applied` confirms
the scheduler's state transition; `failed` names a domain refusal. Read the run
separately for execution progress. MCP replay retains the original receipt.
The UI shows pending/refused commands and continues polling an accepted resume
while the stored run is still paused.

The owner consumes commands in bounded batches. Transition completion commits
with the run update; repeatable remote control delivery has a separate durable
completion marker. Pending controls are reconciled before startup dispatch is
released. API restarts recover their own chat leases and runner capabilities; plan and native-owner recovery belongs to the engine. Worker
restarts discover independently owned native agents and observe existing remote
claims; completion uses the original checkpoint and acceptance rules. Unknown
local ownership retains the existing conservative recovery behavior.

Both processes use private Unix sockets under the data directory:

- `runs-control/engine.sock`: version 1 wakeup (one-second caller deadline) and bounded engine-ownership observations used by recovery. Unavailable ownership blocks cleanup conservatively.
- `runs-api/api.sock`: version 1 API runner operations, five-second per-call
  deadline and bounded payloads. Preparation and idempotent initial dispatch
  tolerate a restarting API through bounded reconnect attempts. Explicit retry
  dispatch is not blindly replayed after transport loss.

The API retains the authenticated runner WebSocket channels, remote Pages
credentials and the bearers of the plan bridge: the worker asks the API over
this socket to open or end the bearer of a local session step (`openPlanBridge`,
`closePlanBridge`) and receives the bearer only. The bearer lives in API memory,
so an API restart ends every local session's Pages tools, and the API drops a
bearer as soon as no step of its session is `running` in the stored run. The worker reads durable progress directly from PostgreSQL, uses
the private bridge for channel operations, and persists deferred capability
cleanup. The API consumes cleanup after reconnect/restart. Neither credentials
nor full plan snapshots are sent over this bridge. The shared PostgreSQL writer
lock serializes existing read/modify/write repositories across service processes;
transaction preconditions do not reuse an earlier request's read cache.

`pages-runs@.service` is a deployment template with `MemoryMax=1G` and a 768 MB V8
heap budget. Adapt paths and the service account to the installation. Native
agents continue to use their independent owner units and budgets. Installing,
enabling or switching live services is a separate operating action; this
repository change performs none of those actions.

ACP capacity remains shared with API chat sessions. Each process recovers only
its own lease scope in separate mode, and PostgreSQL reserves a capacity slot
atomically across both scopes. Resource diagnostics read all leases without
claiming foreign cleanup ownership. Both processes refresh persisted resource
settings before new admission; API shutdown never drains the worker's sessions.
