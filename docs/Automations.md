# Automations (PAGE-297)

An automation wakes an agent, runs a script or starts a plan: by hand, once
at a time, in an interval, weekly at fixed times or when an event of Pages
happens. The page `/automationen`, Pica, the tools of user agents and plan
sessions, and the HTTP API of the Pages MCP client all call the same business
service; none of them has a scheduler, a queue or a rule of its own. The
external MCP client is not part of this repository; this file is the server
side of the shared contract.

Code: `definition/Automation*.ts`, `definition/AgentTools/Automations.ts`
(tool catalog and binding JSON Schemas), `backend/service/automation/`,
`backend/database/repositories/automation/`, migration
`038_automations.sql`, `app/lib/automation-*.server.ts`,
`app/lib/mcp-automation-route*.ts`, `app/routes/api-mcp-v1-automation*.ts`,
`app/routes/automations*.ts(x)` and `app/components/automations/`.

## Rights

- Every signed-in account may create automations; the creator is always the
  authenticated account (a person, or an agent account through its tools).
- A share (`private`, a project or a user group the creator belongs to) lets
  members see an automation. The creator, the managers (`project_members.role
= manager`) of a shared project and active administrators change, switch,
  run and delete it. Administrators see every automation. Readers never see
  script content or a script's output.
- A run always uses exactly the rights of its creator: an agent action needs
  an active agent employee, a plan action a plan the creator may start
  (`canEdit`), a script action an active administrator in administrator
  mode (agent accounts never are one). Ticket and plan events only reach
  automations whose creator may open the project or see the plan.
- Rights are checked when saving (for the creator and, when an action
  changes, also for the account that changes it) and again before every run.
  Without them the run ends as `forbidden` and the automation is paused.
- An agent employee with access "read only" may list and read, nothing else.

## Execution

- The scheduler (`AutomationScheduler`) runs in the process that runs plans
  (`canProcessRuns()`), once per second: events, due times, starts, settling.
- At most one run per automation runs and at most one more waits; the
  database holds this with two partial unique indexes. Further triggers join
  the waiting run.
- A due time is moved before its run is queued, in one transaction: a missed
  once trigger runs once after a restart, a missed interval runs once and
  then keeps its rhythm. A once trigger switches its automation off and
  clears its time when it fires; with `deleteAfterSuccess` a successful run
  deletes the automation with its history, a failed run leaves it paused.
- Times count in the IANA time zone of the trigger (default: the creator's
  zone) and follow daylight saving time; an interval of days keeps the wall
  clock time.
- Agent work (actions, script forwards and agent notifications) waits in the
  queue of its agent (`automation_agent_jobs`) and is delivered by
  `AutomationAgentWorker` in the process that serves the agents' sessions, one
  delivery per agent at a time, in order of arrival. The input goes into the
  agent's own automation session (`agent_conversations.purpose =
'automation'`) and starts an ACP turn as the agent's account; the final
  answer is stored (first 4 KiB).
- Scripts run like script nodes of plans (interpreter profile, workspace,
  allowlisted environment, release gate, limits), but in their own process
  group instead of a PID namespace: at the end of the script only its group
  is ended, so sessions it detached on purpose (`tmux new-session -d`,
  `systemd-run --user`) keep running. stdin carries
  `{automation, runId, trigger, eventType, at, data}`. The run ends with the
  script itself and is stored before anything else, so a restart of Pages by
  a detached process neither repeats nor interrupts it.
- Events: plan runs report through the run observers (`plan.started`,
  `plan.succeeded`, `plan.failed`, `plan.step_changed`), tickets through a
  trigger of `work_items` (`ticket.created`, `ticket.status_changed`), into
  the inbox `automation_events`. An event never starts the automation that
  caused it, and an automation starts at most sixty event runs per hour.
- People hear about runs of their own automations as set under Settings →
  Personal → Notifications → Automations (off, on errors — the default — or
  always), through Pica Mobile push where a device is coupled; otherwise
  nothing happens.

## HTTP API

Base `/api/mcp/v1/automations`, `Authorization: Bearer <device token>` of the
existing pairing (PAGE-243); the token acts with the current rights of its
account. Bodies are JSON (at most 1,000,000 bytes).

| Tool                      | Operation                  | HTTP                               |
| ------------------------- | -------------------------- | ---------------------------------- |
| `read_automation_options` | `automations.options.read` | `GET /options`                     |
| `list_automations`        | `automations.list`         | `GET /`                            |
| `read_automation`         | `automations.read`         | `GET /{automationId}`              |
| `create_automation`       | `automations.create`       | `POST /` (201)                     |
| `update_automation`       | `automations.update`       | `PATCH /{automationId}`            |
| `set_automation_active`   | `automations.setActive`    | `POST /{automationId}/active`      |
| `run_automation`          | `automations.run`          | `POST /{automationId}/run`         |
| `delete_automation`       | `automations.delete`       | `POST /{automationId}/delete`      |
| `list_automation_runs`    | `automations.runs.list`    | `GET /{automationId}/runs`         |
| `read_automation_run`     | `automations.runs.read`    | `GET /{automationId}/runs/{runId}` |

- Lists take `cursor`, `limit` (1–100, default 50), `text` and `isActive` and
  answer `{items, nextCursor}`; runs come newest first.
- Every change carries an `operationId` (UUID): the same call with the same
  ID answers the stored receipt (`replayed: true`) without a second effect;
  other input with the same ID is `409 conflict` (`detail:
operation_reused`). `update`, `active`, `run` and `delete` need
  `expectedRevision`; a stale one is `409 conflict` with `currentRevision`
  and changes nothing.
- `run` answers `{runId, status: accepted|queued, isCoalesced, queuedAt}`:
  accepted work or a waiting run, never a finished one. A run's `status` is
  `queued`, `accepted`, `delivered` (started), `completed` or `failed`; its
  `result.outcome` is `ok`, `failed`, `forbidden` or `skipped`. Deliveries to
  agents have their own state `queued`, `delivered`, `completed`, `failed`.
- `delete` without `confirmed: true` answers the scope (`automationId`, `name`,
  `expectedRevision`, `runCount`, `blockingRunId`, `canDelete`) and changes
  nothing; a running or waiting run blocks the deletion (`409`, `detail:
run_active`).
- Errors: `{error, detail?, currentRevision?, problems?}` with
  `invalid_request` 400, `invalid_token` 401, `forbidden` 403, `not_found` 404
  (hidden and missing alike), `conflict` 409, `too_large` 413,
  `rate_limited` 429 and `server_unavailable` 503 (with `Retry-After`).
  `detail` names a reason such as `time_required`, `script_forbidden`,
  `agent_unavailable`, `plan_unavailable`, `workspace_unavailable`,
  `interpreter_unavailable`, `sharing_target_invalid`,
  `event_filter_invalid`, `delete_after_success_invalid`, `read_only` or
  `validation` (with `problems`: paths and messages, never values).

## Internal tools

The same ten operations are part of the central agent API
(`AutomationOperationService` in both operation routers), of the shared tool
catalog and of Pica's registry (`registerPicaAutomationTools`), which agent
employees receive through their bridge. Plan sessions get the reads with
`read` reach and everything with `full` reach. Deleting needs the person's
typed confirmation word in Pica; the plan bridge has no confirmation surface
and refuses a confirmed deletion with `CONFIRMATION_REQUIRED`.
