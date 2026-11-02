# Agent Plan retries (PAGE-128, PAGE-191)

`AgentPlanStepRunner` keeps a failed unfinished node inside the existing engine
while it waits. There is no additional worker, queue, provider or model choice.
Every attempt prepares the frozen node again and rechecks current access before
dispatch. Completed predecessor nodes and scripts are never replayed by this
policy. Scripts retain their own distinct exit, timeout and cleanup failures.

## One sequence, one policy

Each unfinished node or turn has one persisted retry record. The policy is
fixed by the first classified retryable failure of that sequence:

- A provider failure follows the existing provider policy. The original attempt
  is followed by at most ten retries with waits of 1, 5, 10, 20, 30, 60, 120,
  180, 240 and 300 seconds. The eleventh failed attempt blocks the node with its
  last provider cause.
- A technical ACP session failure follows the session policy. The original
  attempt is followed by at most two retries, each after at least ten seconds,
  so one sequence never exceeds three total attempts. The third failed attempt
  blocks the node with `exhausted` and keeps all three attempts.

A session failure never extends an already running provider sequence: it ends
that sequence without starting another three-attempt policy. A transient
provider failure inside a session sequence shares the three-attempt session
budget. Provider rate-limit, quota and reset rules remain authoritative; the
ten-second session path never shortens a provider lockout or attaches ten more
provider retries behind a three-attempt sequence.

Authentication, access, model/configuration, privacy/ZDR/guardrail, explicit
business `blocked`, invalid requirements, acceptance and deliberate
stop/cancel/timeout outcomes keep their codes and are not transient session
failures. Script failures and Pica chats are outside this policy.

The session policy covers the verified ACP session failures
`plan_acp_session_failed`, `plan_claude_acp_session_failed`,
`opencode_acp_session_failed`, `antigravity_acp_session_failed`, the failed
resume `acp_session_resume_failed` and, for a remote Codex or Claude CLI that
ended without a terminal event or with `error_during_execution`,
`plan_runner_session_failed`. A generic adapter code is classified from its
available sanitized inner diagnostic first, so an authentication, quota,
model, permission or policy cause does not enter the session path merely
because its outer code looks generic.

## Safe continuation

A retry continues the failed turn; it never restarts the plan. The first
choice is the adapter's native session resume, using the recorded session ID
and the adapter's confirmed `session/resume` capability. A native resume keeps
the earlier conversation and its tool history.

A node that ran tools, or that shares its session with a group or loop,
pins its native session ID in the retry record (`requiredResumeSessionId`).
Every later attempt of the sequence then resumes exactly that session; if the
resume fails, the node stops with `resume_unavailable` and never opens an
empty session in its place. A failed attempt that recorded no tool activity
may instead open a new native session, which the attempt notice labels as new.
A tool event alone is not a blanket blocker: the decision names whether native
resume exists or a concrete safety boundary prevents the retry.

### Distinct stops

A stop before the budget is spent names its own cause and is never reported as
an exhausted budget (`reason` of the retry record, shown in the run details,
`read_plan_run` and the UI):

| `reason`                  | Cause                                                                                                  |
| ------------------------- | ------------------------------------------------------------------------------------------------------ |
| `exhausted`               | All three attempts failed; the last concrete error and all three attempts are kept.                    |
| `closeout_unconfirmed`    | The end of the failed attempt is not confirmed, so no replacement may start.                           |
| `resume_unavailable`      | A native session was required (tools ran, shared group/loop session) but it cannot continue.           |
| `session_not_kept`        | Tools ran but the session was not kept, or the adapter offers no continuation.                         |
| `remote_evidence_missing` | A remote writing job came from a runner without continuation support, so nothing proves its effects.   |
| `effect_unknown`          | Tool effects exist or cannot be excluded, and no session record or capability allows reconciling them. |
| `reset_unknown`           | A provider quota without an unambiguous reset (unchanged provider contract).                           |

The original ACP or runner error stays visible as the last cause of the
history, separate from these reasons.

### Where Claude plan sessions are kept (local)

The Claude plan profiles keep their session (`persistSession: true`,
`keepsSession: true`), so the adapter announces `session/resume` and the plan
may use it. Pica's chat profile is unchanged.

A plan session never writes into the connection's own Claude folder. Inside
the bubblewrap namespace it gets a private home below the connection:
`plan-sessions/<runId>/<sha256(scope)>/{home,claude,work}`. The scope is the
node, or the group or loop whose members share one native session, so another
node, run, workspace, user or Pica chat cannot read its transcripts. Only the
connection's one `.credentials.json` is bound into that home, writable so a
refreshed login reaches the connection; settings, other transcripts, user MCP
servers and every other credential stay hidden. A missing or linked login
fails closed. Session ID, transcripts, working directory and connection are
the same on every attempt, so the resume finds its files.

A recovery that resumes natively starts a linked run with a new run ID. Its
first session of a node moves that node's transcripts from the failed source
run, so the history has exactly one owner and the source run offers no second
recovery.

Retention and resume lifetime belong together: every session start renews a
seven-day lease (`retained-until`) on the run's transcripts. A succeeded or
stopped run deletes them as soon as its closeout is confirmed; a failed run
keeps them for seven days so the explicitly reviewed recovery can still
resume. Expired leases are pruned when the connection is next prepared. After
that a resume reports `resume_unavailable` instead of a silent new session. A
connection's removal deletes its transcripts with it.

On a host without bubblewrap nothing separates folders at all, so such a
session keeps the connection's own home, which holds the login; Claude Code's
own retention applies to its transcripts there.

### Remote runners (Runner 1.16.0, `continuationVersion: 1`)

A remote job runs on the operator's host with that account's own CLI homes.
Pages therefore cannot isolate or delete its transcripts and stores only the
session ID and the evidence below. A writing job (`yolo`) to a runner that
announced `continuationVersion: 1` carries `continuation: { version: 1 }`:

- Claude runs without `--no-session-persistence`; a retry runs
  `claude -p --resume <id>`.
- Codex runs without `--ephemeral`; a retry runs `codex exec … resume <id>`.
- OpenCode continues over ACP `session/resume` when the agent announces it.
- Antigravity reports its session and tool activity but offers no resume, so
  only a retry without prior tool calls may open a new session.

The runner's result then carries `continuation`: the native session ID,
whether it can resume, and the proven tool activity (`none` only if the
stream began and showed no tool call; `observed` with a count; `unknown`
when the stream could not be followed). Pages stores that as the session ID,
the continuation capabilities and `effects`, so the same decision applies as
for a local session: native resume when possible, a clean new session when
no tool ran, otherwise a named stop. A runner that cannot resume the pinned
session (`acp_session_resume_failed`) never starts a new conversation.

A runner before 1.16.0 sends none of this; its writing jobs stay stopped as
`remote_evidence_missing` until the operator updates the runner. Server and
runner are separate rollouts: the server accepts both generations, and a
runner that announced the capability is refused a downgrade while a
continuation job is outstanding.

Runner failure classification is conservative: a Claude or Codex job counts as
a technical session failure only when it had begun, ended without its terminal
event or with `error_during_execution`, and neither the event stream nor the
diagnostic tail names a sign-in, quota, rate-limit, model, permission, policy
or ZDR cause. A resume that never began reports `acp_session_resume_failed`.

A retry keeps idempotency and operation keys, expected revisions, workspace
changes and earlier successful results. The retry notice asks the agent to
inspect the current state and not repeat a completed external action. Native
resume keeps the conversation, but Pages does not claim exactly-once external
actions: state reconciliation and idempotency remain the agent's duty.

## Provider waits and quota resets

Temporary `provider_unreachable`, `provider_unavailable` and rate-limit failures
follow the provider waits above. A quota failure with an unambiguous reset waits
until that UTC instant plus 60 seconds, or the increasing retry delay, whichever
is later. A quota without a known reset stays blocked as `reset_unknown`. There
is no periodic probe of an unknown budget and no fallback model. HTTP
`Retry-After`, explicit reset headers and structured reset fields are
understood. Native Claude's rejected `_claude/rateLimit` supplies its
subscription reset. Explicit ISO timestamps or durations in error diagnostics
can supply a reset; a local clock time without an unambiguous date/timezone is
deliberately not guessed. Token-usage totals and missing budget reports are not
quota exhaustion.

For an exhausted billing quota, ordinary request/token-window reset headers do
not establish a release time: only an explicit structured reset or Retry-After
does. Unrelated remaining request capacity never makes that quota available.

## Durable waits and controls

The next deadline is persisted before the wait; a wait holds no native process.
Stop aborts the wait immediately and ends its retry state as `cancelled`.
Pause closes dispatch and retains the deadline and failed-attempt history;
continuing the active paused run observes the same deadline. A resume never
performs a second attempt for the same wait. Reload, reconnect and server or
runner recovery keep the counter, deadline, attempt/session references and
failure metadata; they do not reset the budget and startup starts no provider or
timer automatically. The executor can explicitly continue after checkpoint and
side-effect review. A later independent turn starts with a fresh counter.

Retries require a confirmed native closeout, or a remote job whose terminal
state is proven. Recorded tool activity prevents a new-session replay unless
the session can be resumed; shared sessions without native resume block. These
limits do not claim exactly-once external actions.

## Persisted record and views

The existing session JSON stores classified failure/reset metadata, the
bounded failed-attempt identities/timestamps, the fixed policy, waiting state
and next deadline. No provider diagnostics or credentials enter it. Existing
records without these optional fields stay readable and follow the provider
policy; there is no schema migration. PageAgentCLI journals still own native
attempt messages and usage.

Run details and `read_plan_run` show the policy, cause, state, attempt count of
the total budget, next attempt and last failure; the UI shows `Versuch 1/3` to
`3/3` for session sequences. Success after a retry stays a normal successful
result with the earlier failures in its history. A final failure names the last
concrete cause and the full attempt history. Late or duplicate events of an
older attempt cannot overwrite the newer attempt's record. Successors receive
work only after real successful completion or acceptance.
