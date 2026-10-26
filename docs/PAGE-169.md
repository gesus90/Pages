# PAGE-169 implementation and bounded acceptance

Source: the freshly verified live ticket in
`/home/igor/Results/page169-codex-20261026-1957/ticket-live-verified.json`.
Worktree: `/home/igor/Repo/Pages-page169-codex-20261026-1957`, branch
`task/page-169`. The canonical checkout and deployed main were not used.

## Changes and Eigenentscheidungen

1. **Separate durable custody from archive import.** Migration 077 adds
   `runner_history_recovery`. The control transaction keeps the full validated
   packet with its receipt; archive failures no longer roll back stop/result
   progress. An explicit `history-deferred` receipt names this distinction. No
   packet is discarded, silently acknowledged as imported, or rewritten.
   Per-job head ordering, immutable receipt digests and transactional import
   preserve ordering and deduplication. Background recovery runs outside the
   control queue, retries failed heads after 30 seconds, drains successful heads
   after 250 ms, and resumes from the database after Pages restart.
2. **Fix the proven bounded redaction mismatch.** A valid 4,000-character wire
   record expanded to 7,240 characters under Pages redaction. The previous
   4,000-character archive bound rejected it with `too_big` for `text`. Only the
   public archive text bound becomes 8,000; strict object/field validation and
   the 4,000-character wire limit stay in force. This local reproduction does
   not establish which field failed on either NAS.
3. **Keep diagnostics value-free.** Diagnosis contains allowlisted field paths,
   error codes, expected types, contract version 1, and run/attempt/job
   identifiers. No exception messages, prompts, history text, token values or
   credentials are logged. The complete private packet remains in durable
   custody, including after successful import; storage grows accordingly.
4. **Use Runner 1.11 capability negotiation.** New work requires
   `executionLeaseVersion: 1`; older runners still reconcile existing jobs but
   must be explicitly upgraded for new dispatch and the deferred-history
   receipt. The setup artifact includes `revocation.mjs`. Pairing and journals
   survive upgrade. No automatic installation or service restart was performed.
5. **Use bounded Linux ownership evidence.** Remote cleanup sends TERM, escalates
   after 2 seconds to KILL, and verifies exit for up to another 3 seconds.
   It includes the worker, process groups, marked/reparented children and
   observed descendants. Boot ID plus process start ticks guard PID reuse;
   zombies are not live execution. Unreadable relevant processes, signal errors,
   and live legacy roots without trustworthy boot identity fail closed. The
   dispatcher records its boot-bound ancestry before spawning. Protected
   processes in a proven independent older branch are excluded without reading
   their environment or signalling them; ambiguous branches still fail closed.
   Stop receipts/UI distinguish process-scan, signalling and exit-deadline failures. Only
   owned work is signalled. Host admission retains failed-closeout reservations.
6. **Fence before dispatch and reconnect.** Stop intent is durable and bound to
   run/attempt/job/session. The claim transaction rechecks the run fence. Local
   revocation precedes cleanup and is read before workload launch. Independent
   `stop-result` delivery does not wait for sequenced history. Confirmed evidence
   cannot regress; terminal plan results cannot reopen on late packets.
7. **Bound offline execution.** Authenticated heartbeats renew a monotonic,
   boot-bound 45-second lease. Workers check every 250 ms; the transport checks
   independently every second. Reconciliation applies revocations and expired
   leases before renewal/admission. A terminal local notification waits only
   500 ms after the durable result, correcting a 25-second wrapper tail found
   during manual acceptance. Pages reports `plan_stop_unconfirmed` after
   60 seconds without proof and retains uncertain reservations.
8. **Reuse authorized Recovery → Release.** Do not add a blind force reset.
   An engine-free stopped orphan can request cleanup and then release only
   after remote proof and local process checks. Validate the recovery revision
   before cleanup and again at commit. Record the decision, terminalize the
   proven-free orphan and release its locks in one transaction. Preserve all
   history, results, workspaces and pairing. Run/control diagnostics retain
   legitimate authorization/read failures instead of reporting every failure
   as `own_run_required`.
9. **Keep the implementation scoped.** Existing engine dispatch gates cover
   local groups, loops and retries. Remote members inside groups/loops remain
   unsupported by the existing target validator; this task does not enable
   them. Small runner checkpoint/connection/history helpers keep file/function
   limits intact. Confirmed cancellation also removes private runtime copies, including on
   idempotent replay. No dependencies or test infrastructure were added.

## Commands and static results

Commands ran in the task worktree. Following continuation, shell PATH did not
include pnpm; commands were explicitly pinned with
`export PATH=/home/igor/.nvm/versions/node/v24.19.0/bin:$PATH`.

- `pnpm install --frozen-lockfile --offline`: passed; cached dependencies only,
  no manifest/lockfile changes.
- `pnpm --dir mcp install --frozen-lockfile --offline`: passed; needed by the
  existing build's MCP packaging step. No MCP tests or server were started.
- `pnpm exec tsc --noEmit`: initial failure because route-generated types were
  absent; the mandated check's typegen supplies them. A later standalone run
  passed after correcting the history-provider mapping.
- `pnpm run check`: earlier type/format pass; subsequent intermediate runs
  caught formatting while implementation/docs were changing. Final result is
  recorded below.
- `pnpm run lint`: initial nine function/complexity/size issues were corrected
  by focused extraction; a later unused import was removed. An intermediate
  complete run passed. Later checks found a new helper ordering issue, the
  provider mapping type, optional-chain complexity, and temporary synthetic
  Python copies named `.cjs`; all were corrected without changing rules. Final result is recorded below.
- `pnpm run build`: initial failure because the independent MCP package's cached
  dependencies were not installed. Subsequent builds passed. Existing warnings
  concern CSS `::highlight`, Rollup/Zod annotations, chunk size and MCP JSON
  import attributes; they do not demonstrate functional coverage.
- `for file in scripts/runner/*.mjs; do node --check "$file" || exit; done`:
  passed at the recorded manual schema check.
- `bash -n scripts/pages_setup.sh`: passed.
- `git diff --check`: passed at that check; final result is recorded below.
- `pnpm exec tsx -e '<manual schema projection>'`: 4,000 input characters,
  7,240 projected characters, previous bound rejected with `too_big` and
  expected type `string`, current strict archive accepted. The command prints
  counts/schema facts only, never the synthetic text.
- Early broad formatting also attempted `.sh` and returned parser-unavailable;
  shell files were subsequently checked with `bash -n` and other changed files
  with their proper formatters.
- Three commands immediately after continuation returned 127 because pnpm was
  missing from PATH; their pinned replacements were run. Interrupted tool
  sessions without an exit result are not counted as passing gates.

No unit/integration/smoke/E2E/browser/regression tests, fixtures, mocks or
harnesses were developed. Neither Pages test script nor coverage was executed.

## Manual isolation and observations

The isolated instance uses a new DuckDB database/config under `data/page169/`,
loopback Pages port 43169, a separate task-owned SSH daemon on 42769, newly
created synthetic SSH keys and a separate runner directory/admission directory.
Only synthetic workspace directories inside this worktree are used. The runner
uses an empty CLI home and `/usr/bin:/bin` CLI PATH; no provider is configured.
A synthetic project has inert GitHub URL metadata, no token, no sync flags and
interval zero. No GitHub request, paid/model call or external mutation was
requested. Synthetic account/departments/project/connections/workspaces/plans
were created through the product's setup/services and authenticated HTTP forms.
No product DB status was manually corrected.

Runtime commands:

```sh
/usr/sbin/sshd -D -e -f "$PWD/data/page169/ssh/sshd_config"
node server.mjs --config "$PWD/data/page169/instance/config.toml"
PAGES_RUNNER_DIRECTORY="$PWD/data/page169/runner" \
PAGES_RUNNER_ADMISSION_DIRECTORY="$PWD/data/page169/admission" \
PAGES_RUNNER_CLI_HOME="$PWD/data/page169/cli-home" \
PAGES_RUNNER_CLI_PATH=/usr/bin:/bin PATH=/usr/bin:/bin \
/home/igor/.nvm/versions/node/v24.19.0/bin/node scripts/runner/transport.mjs
```

Manual HTTP interactions used `node --input-type=module` with `fetch`, the
private synthetic cookie read from disk, and React Router's existing single-fetch
decoder. They submitted `save-department`, `set-memberships`, `create-project`,
`save-integration` (inert metadata), `save-connection`, `save-remote-workspace`,
`connect`, `authorize`, `save-plan`, `play-plan`, `stop-plan`, run polling and
recovery requests. Only status/identity/count/hash metadata was printed.
Failed setup attempts were contained: host-key input initially included an
unsupported comment; a workspace assignment initially lacked the required
project metadata; first authorization preceded the five-second stable SSH
condition. Each was corrected through the ordinary product flow.

### Sequential execution

From 2026-10-26 19:51:20–19:51:31 UTC, three consecutive Python remote scripts
completed on the same target, with distinct immutable identities:

| Order | Run                                    | Attempt                                | Job                                    | Elapsed  | Result                |
| ----- | -------------------------------------- | -------------------------------------- | -------------------------------------- | -------- | --------------------- |
| 1     | `98e35b3e-7078-4bc2-ad0a-652ed07d10c0` | `2447bedc-91f9-4eca-bf95-24836a62c049` | `e515caad-55d7-4e08-b503-12bdcf4a27f0` | 3,905 ms | succeeded / confirmed |
| 2     | `75a4c286-03b0-4ad5-8806-dc0da1adadba` | `a91c04de-6be2-4120-a673-ef2075cea658` | `b7295341-4c35-456c-a3a6-c7c1d3bddc6c` | 3,309 ms | succeeded / confirmed |
| 3     | `7f6f970b-ef9a-40a8-b2f8-77f21321e504` | `2187aeed-cc5f-4758-95cc-e43cf7df3d5c` | `c9e58d77-8b15-44b0-86f9-3696d23acddc` | 3,303 ms | succeeded / confirmed |

The append-only synthetic execution marker contained exactly three distinct job
IDs. Each result had 18 bytes and the same expected SHA-256 digest
`8322b2bb0dd76d125193fadc148adaf4aaf8cd18d9e59b447a52ca2d7b28ef1c`.

### Initial queue isolation and hard stop

At 19:52:02/04 UTC, quiet run
`2799d5a7-e004-4d89-aecb-c9c52e30c533` and chatty run
`5d9a0670-cdf2-409e-bb78-6e09fea99410` were accepted on separate workspace paths. Later inspection showed that these
paths initially inherited this worktree’s same Git branch, so host admission
serialized their actual execution. This first pair is **not** evidence of
simultaneous execution; the corrected overlap observation follows below.
The quiet Python parent and its separate-session child ignored TERM. Before
Stop, PIDs 9784/9785 had matching boot-bound identities. Stop persisted at
19:52:09.480, receipt at .494, cleanup confirmation at 19:52:12.020 UTC. Both
live identities disappeared within 2,539 ms of the request. An independent
synthetic sleep process stayed alive and was then ended by its own handle.
The quiet run remained cancelled/confirmed after reload. The chatty script
produced 60 bursts of 800 characters over 15 seconds and completed successfully
with 48,079 bytes, confirmed cleanup and its own attempt/job. An early poll
still said running before its durable terminal event arrived; the later read
verified completion. Post-stop order `41469016-d999-4574-a39d-e2676691f7d7`
was accepted at 19:56:43 UTC and its 18-byte successful result survived restart.

### Disconnection and persisted uncertainty

At 19:57:22 UTC the task-owned runner transport (PID 11020) was paused with
SIGSTOP while quiet run `058045ae-4e9f-4592-861e-b55b9af12566` was running.
Stop was accepted; its original job was
`82d75ab1-b8da-461d-a0ee-150ddba2d951`. Lease expiry ended the workload and
stored an interrupted/confirmed result at 19:57:58.992 UTC. The wrapper's old
25-second terminal notification wait meant the initial all-process bound was
not met; this observation caused the 500-ms fix described above. A later scan
proved the wrapper and both workload identities absent. The original run
became failed at the 60-second server deadline with `plan_stop_unconfirmed`,
not successful cleanup inferred from a missing channel.

While the paused runner had not delivered proof, ordinary Release requests
returned 409 `cleanup_unconfirmed` and kept the reservation. This exposed that
revision validation originally happened after cleanup; the implementation now
checks it before cleanup as well as at commit. The paused transport and isolated
Pages process were killed by exact PID and restarted using the same journals.
No pairing reset or DB correction was used. On reconciliation the stop was
applied, cleanup became confirmed, the run stayed terminal failed and the
reservation was released. Recovery then reported `nothing_to_release`; a hash
comparison verified the same runner/session/token pairing. Previously successful
results remained readable. Further observations and final gates follow below.

### Pages orphan, conservative failure and corrected overlap

Run `a714ca19-0a6e-45ee-bb06-14954a371fe1` was accepted at 20:31 UTC. Its
worker was paused with SIGSTOP, Pages was killed by exact PID and restarted,
and the same run/attempt remained readable. Normal Stop ended all three
recorded identities within 2,327 ms. Cleanup nevertheless reported failed: an
independent protected SSH session made absence ambiguous for the old claim,
which lacked an ancestry snapshot. The product kept the run failed and its
reservation held. No unrelated SSH/IDE process was killed and no forced reset
was used. The private synthetic executable copy was removed only after all
recorded process identities were proved absent, preserving results/history.

This finding led to persistent dispatcher ancestry and typed stop-failure
diagnoses. Old ambiguous claims remain conservative; they are not retroactively
certified by the new metadata. The manual acceptance also created separate
empty Git repositories using `git init --initial-branch=page169-synthetic`
under each of the three task-owned workspace directories. This prevents the
host’s intentional same-branch reservation from serializing independent work.
No parent repository history/configuration or external repository was changed.

The already accepted job `2cb72d1e-4e01-462e-ba4b-46ff0472590f` then left its
visible workspace queue without being resubmitted. At 20:41:13 UTC, quiet run
`2ee1913b-3b6e-4fba-9f80-29d57043a12f` and output-heavy run
`c7899e50-364e-46b6-ae82-ea3e4f839bcf` were **both physically executing**.
The quiet worker and two descendants had recorded boot-bound identities; its
worker was deliberately paused. Stop killed all three within 2,303 ms. The
other workload’s exact process identity was still alive after that exit. The
quiet run became cancelled with confirmed cleanup at 20:41:15.709 UTC. Its
ancestry snapshot contained seven ancestor identities. This is the actual
overlap/hung-worker acceptance, replacing the earlier weaker queue observation.

### Final lease expiry, restart and conflict checks

The corrected output-heavy overlap run completed with 48,079 bytes and confirmed
cleanup; its attempt was `c7e50425-0fea-438a-aacb-7b1ef86d8e65`.

At 20:42:59 UTC, run `5b9f6dda-ae83-4085-931b-0ba18de2e267`, job
`18133f2a-e390-4f89-9de6-4b22faf900f5`, was running with a fresh ancestry
snapshot. The transport alone was paused, with 37,340 ms remaining on its
45-second execution lease. Ordinary Stop persisted its original intent. Both
TERM-ignoring workload identities exited after 39,789 ms; the wrapper also
exited after 42,811 ms, including cleanup, the corrected notification limit and
500-ms observation granularity. Thus the complete recorded tree ended within
the lease plus bounded cleanup; this replaces the earlier failed wrapper-tail
observation. No paid/model call occurred.

Before reconnect, Pages honestly stored failed / `plan_stop_unconfirmed`, with
stopRequested still true. Both the paused transport and Pages were killed by
exact task-owned PID, then restarted from the same files. At 20:44:46 UTC the
same run remained terminal failed, its cleanup was confirmed, the transient
stop error was cleared, and Recovery showed `nothing_to_release` with no
unconfirmed cleanup. Runner/session/token hash equality proved pairing was
preserved. No old attempt was restarted. The cleanup receipt itself took
7.7 seconds to arrive after reconnect under local I/O/CPU load, despite all
recorded workload processes having already exited before restart; receipt
latency is distinct from physical exit and is not an unconditional five-second
host-I/O guarantee.

The older ambiguous orphan remained reserved, as intended. A Recovery → Release
request with the wrong recovery revision returned 409 `revision_conflict`
before cleanup, independently confirming the early revision fence. The same
API’s earlier correct-revision request returned `cleanup_unconfirmed` when host
absence could not be proved. An actually successful Release transaction for a
legacy orphan was not manually demonstrated; the ordinary confirmed-stop path
releases reservations without a blind reset.

### Fresh orders on the final build and teardown

After the final build and another isolated Pages restart, the same serial target
accepted three new explicit orders at saved plan revision 3:

| Order | Run                                    | Attempt                                | Job                                    | Elapsed  | Result                |
| ----- | -------------------------------------- | -------------------------------------- | -------------------------------------- | -------- | --------------------- |
| 1     | `2615731e-a4e5-44c4-8daa-b724f991c2b3` | `4a949722-d198-4d0c-a5dd-bd1e1a8a04c3` | `226c7326-1050-4b09-a29a-c13c460a18fd` | 3,018 ms | succeeded / confirmed |
| 2     | `56b85807-7db5-435f-b690-7e090d3264c9` | `69ecc4e0-bcb7-49eb-96fa-f7b8f8ea855d` | `633b7830-cff3-43b0-a62b-826319e68939` | 3,806 ms | succeeded / confirmed |
| 3     | `c3e50ddc-51af-45e8-b0e0-2334274ef896` | `42f57058-ad5b-41d2-83a1-fb82afb70541` | `bf50a34a-1255-4414-826a-be155e4f9bc6` | 2,812 ms | succeeded / confirmed |

At 20:46:59 UTC, the journal contained 14 distinct jobs and 14 distinct attempts;
the synthetic append-only markers contained exactly 14 distinct workload starts,
with exactly one start for every accepted job and no pending wire event. Both
the original and final three successful outputs retained their expected
18-byte result digest after reload/restart. Serial and chatty controls returned
HTTP 200, `canPlay: true`, no blocker and the correct newest run. The deliberately
ambiguous legacy quiet orphan returned HTTP 200 with terminal failed status,
`canPlay: false`, and concrete `plan_stop_unconfirmed` rather than an unexplained
busy state. It was not silently reset.

The elapsed observation window was 19:51–20:47 UTC, including implementation,
rebuilds and a continuation pause; it was not a continuous load/stress run.
Load was bounded to synthetic Python processes, two 48,079-byte output jobs,
TERM-ignoring children, a paused worker and a paused transport. Software was
Node 24.19.0, Python 3.14.4, Pages at this worktree's source revision plus this
uncommitted implementation, Runner 1.11.0, wire/communication/lease contract 1,
output-journal contract 2. Only the local synthetic serial/chatty targets have
this readiness evidence. The legacy quarantined target and production
NAS/provider chain do not.

All recorded synthetic launch/child identities were absent before teardown.
The task-owned Pages process, runner transport and SSH daemon were stopped by
exact PID. No independent SSH process, IDE, writer or production service was
stopped. Private runtime state, result/history evidence and synthetic workspaces
remain under the ignored task data directory; no pairing/history reset occurred.

The final authenticated setup download returned 200, 201,758 bytes, included
`revocation.mjs`, and contained no unexpanded `__PAGES_…__` placeholder.
`bash -n data/page169/generated-setup.sh`, the source shell syntax check,
`node --check` for every runner module, and `git diff --check` all returned 0.
The generated setup was inspected only; it was not installed or executed.

## Independent live NAS findings and remaining acceptance

These are ticket facts, not new live observations. Production access/recovery
and deployment are outside this authorization.

| Target     | Known persisted correlation from live ticket                                                                                                                                                                                                                                                                                             | Still unverified                                                                                                        |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Mobile NAS | Plan `2e7e5e3b-ceb8-4019-95cc-3ac5d7d8dd75`, revision 16; run `5f211a2d-7c73-4637-b4b9-9dfc30b0a046`; attempt `789b3e1c-c6be-4a6b-8a23-1a744b816f16`; stopping/stopRequested, remote preparation step running                                                                                                                            | Current claim/job, delivery, real worker/process freedom, its own root cause and production recovery                    |
| PAGES NAS  | Plan `d0ea207e-bb69-43e1-8212-5d0cac25f052`, revision 9; run `9da18b48-610a-44cb-bd59-5bfc16e0bb8d`; attempt `29044c8f-8263-450c-8b9c-a63cd3e57a44`; job `61900bd3-fea0-4a73-a090-6ca6391e6048`; repeated unacknowledged history transaction failure, separate detail/recovery authorization and `read_plan_run` INVALID_REQUEST reports | Exact schema field, current process/claim state, actual user's authorization/run-selection failure, production recovery |

The repeated failure mechanism is established by the ticket: archive parsing
aborted the transaction containing the receipt, so the unchanged pending event
was retried and the channel closed. The local `text` reproduction is a concrete
compatible defect; it is not proof of a shared NAS root cause. The implementation
adds safe field diagnosis for the next authorized observation and preserves
legitimate visibility boundaries. It does not bypass authorization or guess
which request produced INVALID_REQUEST.

Unverified host/provider boundaries include real NAS permissions/kernel/process
behavior, actual Codex/Claude/OpenCode/ACP/model execution, physical host reboot,
uninterruptible kernel tasks, system-wide scheduling failure, and a malicious
same-user descendant that removes its job marker and reparents before being
observed. There is no mandatory cgroup containment introduced here. A physical
exit guarantee cannot be made for an unreachable host from server state alone.

Full live acceptance remains open, including separate authorized NAS diagnosis
and recovery and provider-backed remote readiness. The manual script path does
not generate CLI history, so an end-to-end failing CLI-history checkpoint plus
Stop was not demonstrated without introducing a prohibited mock/provider call.
Durable failed-history recovery and its automatic retry code were inspected,
but that inspection is not functional acceptance of the failure path. No claim
of general “Remote stable” follows from this bounded synthetic run.

## Final gates, acceptance disposition and Git state

Final command outcomes, with the pinned Node/pnpm PATH stated above:

| Command                                                                                                                                                                                                                           | Final result                                                                                                                     |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm run check`                                                                                                                                                                                                                  | exit 0; React Router typegen, TypeScript and repository Prettier check passed                                                    |
| `pnpm run lint`                                                                                                                                                                                                                   | exit 0; no errors or warnings, no rules changed/suppressed                                                                       |
| `pnpm exec eslint backend/service/runner/RunnerStopState.ts backend/database/repositories/runner/RunnerHistoryRecoveryRepository.ts backend/database/repositories/agent/AgentPlanRecoveryExecutionRepository.ts --max-warnings=0` | exit 0 after the final helper/SQL layout changes                                                                                 |
| `pnpm run build`                                                                                                                                                                                                                  | exit 0; final SSR/client/MCP packaging build completed in 14.80 s with the previously listed warnings                            |
| `for file in scripts/runner/*.mjs; do node --check "$file"                                                                                                                                                                        |                                                                                                                                  | exit; done` | exit 0 |
| `bash -n scripts/pages_setup.sh`                                                                                                                                                                                                  | exit 0                                                                                                                           |
| `bash -n data/page169/generated-setup.sh`                                                                                                                                                                                         | exit 0; downloaded artifact inspected, never executed                                                                            |
| `git diff --check`                                                                                                                                                                                                                | exit 0                                                                                                                           |
| `node --import tsx --input-type=module` with the real `Database` and `RunnerHistoryRecoveryRepository`, against the stopped isolated instance                                                                                     | exit 0; final ordered-recovery SQL executed, zero retained packets / zero pending connections; no fixture, mock or production DB |

The last manual SQL-layout command was first attempted with `pnpm exec tsx -e`;
that invocation failed before execution because its eval output was CommonJS and
did not support top-level await. The ESM loader invocation above corrected the
command. It demonstrates query validity with an empty inbox, not failed-packet
recovery. Intermediate check/lint failures (including helper ordering, provider
type and optional-chain complexity) were fixed in code; temporary synthetic
runtime copies were cleaned after recorded process exit, not hidden by lint
exclusions. The final SQL changes only expand column/condition layout and name
the internal window alias; focused lint and the real empty-inbox query verify
them in addition to the full gates. No test suite or coverage claim is made.

| Ticket area                                                                                         | Disposition                                                                                                                                       |
| --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Local concrete schema mismatch and sanitized diagnosis                                              | Reproduced and fixed; exact production field remains unproved                                                                                     |
| Durable history custody/import ordering/deduplication                                               | Implemented; failing CLI-history/Stop acceptance still unverified                                                                                 |
| Silent/noisy execution, paused worker, hard targeted kill, true independent overlap                 | Verified locally with recorded identities, deadlines and durable outcomes                                                                         |
| Offline lease, stop uncertainty, runner/Pages restart, no duplicate starts, fresh subsequent orders | Verified locally within the bounded synthetic window; one ambiguous older claim correctly retained                                                |
| Authorized run/control/recovery access and revision refusal                                         | Verified for the synthetic owner, including concrete stop blocker and 409 revision conflict; other users/MCP live requests not manually exercised |
| Recovery after confirmed cleanup                                                                    | Ordinary stop proof released reservations and allowed fresh work; successful explicit Release of a legacy orphan not manually demonstrated        |
| Separate Mobile NAS and PAGES NAS correlation, root causes and recovery                             | Still open; production observation/recovery is outside authorization                                                                              |
| Preservation                                                                                        | Original successful result digests, all 14 unique starts, workspaces and pairing retained; no production reset or history wipe                    |
| Static gates and bounded acceptance                                                                 | Passed/reported as above; no test development or suite/coverage execution                                                                         |
| Overall remote readiness                                                                            | Evidence applies to these local synthetic serial/chatty targets only; no full NAS/provider readiness or unlimited reliability claim               |

Git remains on `task/page-169`, HEAD `0646479`, with 36 modified tracked files and
9 new untracked source/documentation files. Nothing is staged or committed;
no new commit, push, merge or deployment was made. This is the reviewable working
implementation, not a production rollout. No files under tests, mobile, the
independent MCP source/manifests, or the root package manifests/lockfile changed.
The ignored isolated runtime/evidence files remain local to this worktree.

### Local acceptance follow-up (2026-10-26)

The authorized follow-up attempted to close the two remaining local proof gaps
without changing source or existing runtime evidence. Both are **blocked**, not
passed. The existing ordinary synthetic workload path produces no CLI session
history, so a real rejected history checkpoint concurrent with Stop cannot be
induced without a provider/CLI run or a prohibited injected packet/fault hook.
The empty-inbox SQL proof and source review do not establish that behavior.

The existing ambiguous legacy orphan remains preserved as a negative case: its
stale-revision request returned 409, and the current-revision request returned
`cleanup_unconfirmed` because absence could not be proved. Ordinary confirmed
Stop releases its reservation, so it does not create an eligible orphan for an
explicit Release. The isolated product flow has no normal interaction that
creates a terminal, process-free but still-reserved orphan; DB manipulation,
cleanup bypass, or eligibility weakening would be required and was not done.
No positive Recovery → Release result is claimed. Detailed follow-up evidence is
in `/home/igor/Results/page169-codex-20261026-1957/acceptance-20261026/local-acceptance-followup.md`.
At 22:01:45 +01:00 the task-owned Pages/runner/sshd processes and ports were
confirmed absent; no helper teardown was needed. No source changes, test
execution, provider access, production access, or scheduler changes occurred.

#### Follow-up interruption attempt (22:07 +01:00)

The categorical statement above that ordinary product interactions cannot create an eligible reserved orphan is withdrawn. Source review shows a plausible ordinary remote-interruption branch: an ended detached run with remote closeout still pending/failed can remain reserved, and the Release option may then be available. This is not functional proof. A fresh product Play attempt in a clone of the synthetic instance failed before dispatch (`plan_runner_admission_failed`, run `722fa060-721f-438e-94fd-9df8afcc7615`), so there was no live workload to interrupt and no positive Release request was made. The positive Recovery → Release proof remains blocked, not passed. The original ambiguous orphan and database were preserved. Details and helper teardown boundary are in `/home/igor/Results/page169-codex-20261026-1957/acceptance-20261026/local-interruption-attempt.md`.

A subsequent diagnosis found the first Play failure was caused by the follow-up's own runner admission directory mode (`0775`, rejected by the runner's owner-only private-directory guard); the copied runner config also reused old session/journal state. A new private-mode setup proved its synthetic SSH reachability, pinned host key and authentication through the product test action, but the ordinary connection update returned HTTP 500 and shut down the cloned server with `database_invalidated`; the unchanged connection remained at revision 1. No workload was admitted, so no controlled interruption or Recovery Release was performed. This is **blocked/not proven**, not acceptance success. Exact evidence and teardown are recorded in `acceptance-20261026/local-interruption-attempt.md`.

#### Fresh clean-instance connection follow-up (2026-10-26)

A separate database was then created from an empty directory through ordinary
first-run onboarding (77 migrations; no prior DB/config/runner identity was
copied). On this fresh database, a new loopback synthetic SSH target passed
reachability and host-key confirmation, and ordinary `save-connection` and
`save-remote-workspace` both returned successful product responses. This
narrows the previous observation: the cloned-instance SQL failure did not
recur in this fresh setup, but these observations do not establish that cloning
caused the prior failure or identify its cause. A runner/workload was not
launched, so there is still no interruption candidate and no positive explicit
Recovery → Release proof. See
`/home/igor/Results/page169-codex-20261026-1957/acceptance-20261026/recovery-clean-fresh-instance.md`.
The product setup activated automatic sanitized `codex_cli` check/login-cancel
process events despite no manual CLI/provider invocation; no model/provider
request was made. The clean instance and SSH target were stopped, and their
ports were verified free.

### Authorized controlled synthetic proofs — superseding local proof gaps

The user's narrow 22:30 exception authorized isolated fixture states and archive
fault injection for the two missing local proofs only. Parent-executed helpers
now passed with actual exit 0; no implementation source or test suite was changed.

- **History/Stop:** real checkpoint, custody/progress and stop-result handling
  committed two deferred packets and confirmed cancellation despite one injected
  archive INSERT failure. After DB reopen the real background recovery imported
  both in order, about 60 seconds later (65-second observation window), without
  another runner message. Replay stayed duplicate-free; conflicting digest was
  rejected; terminal status, nonempty prior output and snapshot stayed preserved.
  The initial 33-second attempt failed; it is retained and is not a passing gate.
- **Recovery → Release:** a separate synthetic terminal reserved run returned
  released/revision 1, removed its reservation, produced exactly one journal row,
  rejected a stale revision by Error.code, and replayed the original command.
  Nonempty result, full snapshot, attempt/events and public history chunk were
  unchanged immediately and after reopening the DB.

These close the two **local synthetic integration** gaps, not the separate NAS,
provider, authenticated HTTP/cross-user or production-readiness criteria. The
older claims that these proofs were not executed/blocked describe earlier
attempts and are superseded at this boundary only. No Review/Done transition,
commit, push or deployment is implied. Exact commands, exit files, isolated DBs,
failed attempts and limitations are recorded in
`/home/igor/Results/page169-codex-20261026-1957/acceptance-20261026/controlled-2230/controlled-proof-report.md`.
Independent read-only evidence QA passed both bounded proofs; its findings and
the reconciled historical-report warning are saved in `independent-evidence-qa.md`
beside that report.
