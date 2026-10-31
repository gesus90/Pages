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
`opencode_acp_session_failed`, `antigravity_acp_session_failed` and
`acp_session_resume_failed`. A generic adapter code is classified from its
available sanitized inner diagnostic first, so an authentication, quota,
model, permission or policy cause does not enter the session path merely
because its outer code looks generic.

## Safe continuation

A retry continues the failed turn; it never restarts the plan. The first
choice is the adapter's native session resume, using the recorded session ID
and the adapter's confirmed `session/resume` capability. A native resume keeps
the earlier conversation and its tool history.

If native resume is unavailable, a new native session is allowed only when the
failed attempt recorded no tool activity, so no external mutation can be
duplicated. That attempt is labelled as a new native session, not as a
continued conversation. Shared group and loop sessions require native resume;
replacing them with a new session would lose earlier turns. Writing remote
one-shot jobs have neither native resume nor a retained tool trace and stay
blocked as `unsafe` with their concrete cause; explicit recovery is required.
Reading-only remote jobs may follow the session policy as a fresh one-shot job.
A tool event alone is not a blanket blocker: the decision names whether native
resume exists or a concrete safety boundary prevents the retry.

A retry keeps idempotency and operation keys, expected revisions, workspace
changes and earlier successful results. The retry notice asks the agent to
inspect the current state and not repeat a completed external action. Pages
does not claim exactly-once external actions where the session or effect cannot
be verified.

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
state is proven. Recorded tool activity prevents a new-session replay; shared
sessions without native resume block. These limits do not claim exactly-once
external actions.

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
