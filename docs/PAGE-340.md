# PAGE-340: Clean up ACP reservations without a host restart

## What changed

- **Administrative check and cleanup.** Settings → System → ACP resources has
  "Reservierungen prüfen" for an active administrator in admin mode. The
  preview (`intent=check-acp-leases`, `mode=preview`) classifies every
  reservation and changes nothing. The confirmation (`mode=cleanup`) sends
  exactly the previewed releasable instance IDs. The result shows released,
  active or paused kept, not reliably provable kept and failed checks per
  reservation, with reason and next step. The view then reloads the stored
  state. The action and `ServerSettingsService.checkAcpLeases` both check the
  permission (`AcpLeaseCleanup`, `backend/service/agents/resources/`).
- **Responsibility.** Only the scheduler of the service that owns a lease
  checks and releases it (`AcpLeaseAdmission.owns`). In `runsMode = "separate"`
  the API service handles the Pica leases. Plan leases are shown there as
  `other_service` and left to the periodic check of the plan service.
- **Never touched.** Starting leases, open, running, idle or closing sessions
  and leases of paused runs are kept without a process check
  (`start_in_progress`, `session_open`, `run_paused`). No process or unit is
  ended or signalled.
- **Evidence.** The periodic check's classifier (`classifyLease`) is reused:
  owner, namespace identity with boot and PID start time, running worker units
  and boot change. In addition, a spawned lease without identity counts as
  ended (`unit_ended`) only if three things hold. The service manager must be
  readable and list no running unit of the lease. The user journal must show
  exactly one worker unit of the lease that started. Its last manager event
  must be an end (`readJournaledWorkerUnitEnds`). Age, a missing PID or a
  missing marker prove nothing. Missing, rotated or contradictory journal
  data keeps the lease as `start_unconfirmed` or `legacy_unproven`.
- **Recheck before removal.** A confirmed lease is classified again inside the
  scheduler's serial writes, with fresh units and journal, right before the
  guarded `releaseUncertain` delete (`state = 'cleanup_failed'` only). A lease
  that changed stays (`lease_changed`). A release is reported only when the
  store no longer lists the lease. Repeating the cleanup releases nothing more.
- **Process frame of new sessions.** A session without a PID namespace, such
  as an unisolated YOLO chat, already runs in its own limited worker unit
  `pages-acp-<instance>-<hex>.service`. Its directly spawned process identity
  (PID, UID, start, boot) and the unit name are now stored at the reservation
  before the first ACP request (`lifecycle = process`). `closeCliSession` with
  `worker_unit` confirms through the settled unit instead of the legacy scan,
  which always threw "Process ownership is unverified". A unit counts as
  settled only once the service manager reports it inactive or failed after
  its stop. A failed start whose own closeout confirmed its frame calls
  `AcpStartLifecycle.confirmStartEnded`, so its reservation is released.
- **Group observer.** Observer and decision sessions created their working
  directory below `tmpdir()`. `pages-api@.service` runs with `PrivateTmp=true`,
  and the worker unit started by the user service manager does not see that
  `/tmp`, so bubblewrap could not bind the directory. Every session failed
  before `session/new` (`antigravity_acp_session_failed`,
  `opencode_acp_session_failed`). The directories now live in
  `observer-sessions` next to `pica-sessions`. The result of observer calls is
  shown to group members in the group context, with consecutive failures and
  their cause, and to administrators in the ACP resource view (last 24 hours).

## Not done here

- `AgentPlanDecisionModel` (plan branching) still uses `tmpdir()` in the plan
  service and is likely affected the same way. It was left unchanged to keep
  the scope of this ticket.
- Not every historical reservation can be proven ended afterwards. If the
  journal no longer covers it, it stays reserved until a host restart, which
  the periodic check recognizes as `previous_boot`.

## Live cleanup (later, separate from the implementation)

After the deploy, an administrator runs the preview in the resource view,
checks the categories and confirms the release. Nothing in this ticket
changed live reservations, processes or data.
