# Agent Plan provider waits (PAGE-128)

`AgentPlanStepRunner` keeps a failed unfinished node inside the existing engine
while it waits. There is no additional worker, queue, provider or model choice.
Every attempt prepares the frozen node again and rechecks current access before
dispatch. Completed predecessor nodes and scripts are never replayed by this
policy. Scripts retain their own distinct exit, timeout and cleanup failures.

The original attempt can be followed by at most ten retries. Temporary
`provider_unreachable`, `provider_unavailable` and rate-limit failures wait
1, 5, 10, 20, 30, 60, 120, 180, 240 and 300 seconds. The eleventh failed attempt
blocks the node with its last provider cause. Authentication, model/configuration,
permission, timeout and business failures are not transient retries.

A quota failure with an unambiguous reset waits until that UTC instant plus
60 seconds, or the increasing retry delay, whichever is later. A quota without
a known reset stays blocked as `reset_unknown`. There is no periodic probe of an
unknown budget and no fallback model. HTTP `Retry-After`, explicit reset headers
and structured reset fields are understood. Native Claude's rejected
`_claude/rateLimit` supplies its subscription reset. Explicit ISO timestamps or
durations in error diagnostics can supply a reset; a local clock time without
an unambiguous date/timezone is deliberately not guessed. Token-usage totals and
missing budget reports are not quota exhaustion.

For an exhausted billing quota, ordinary request/token-window reset headers do
not establish a release time: only an explicit structured reset or Retry-After
does. Unrelated remaining request capacity never makes that quota available.

Retries require a confirmed native closeout, or an API request with no process.
A shared group/reused-loop session cannot be replaced without losing its earlier
turns; it blocks for explicit recovery. Recorded tool activity also blocks
automatic replay, because its side effects need review. Native diagnostics that
do not identify a known transient cause remain ordinary failures. These limits
do not claim exactly-once external actions.

The existing session JSON stores only classified failure/reset metadata, the
bounded failed-attempt identities/timestamps, waiting state and next deadline.
No provider diagnostics or credentials enter it. Existing records without these
optional fields stay readable; there is no schema migration. PageAgentCLI
journals still own native attempt messages and usage.

The next deadline is persisted before the wait. A wait holds no native process;
stop aborts it immediately. Pause closes dispatch and retains its deadline;
continuing the active paused run observes the same deadline and failed-attempt
history. Adopting a draft cannot change a waiting node's connection, provider,
model or reasoning; an explicit stop and new run are needed for another route.
Each new attempt
has its own timeout, excluding waiting. Backend shutdown interrupts the existing
run using normal recovery; startup starts no provider or timer automatically.
The executor can explicitly continue after checkpoint and side-effect review.
The original run and its attempt history remain available.

Run details show the state, cause, reset, next attempt and failed attempts in
German or English. Provider metadata and these component views need real
provider execution to establish end-to-end conformance; deterministic parsing
checks alone are not evidence of an actual quota/reset event.
