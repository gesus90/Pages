# Decision, boolean result and event retrigger (PAGE-174)

A `decision` plan node lets a plan branch on a boolean result and lets a later
node hand new information back to an agent that already ran. This file is the
contract of the behaviour. The types live in `definition/AgentPlan.ts` and
`definition/AgentPlanBranching.ts`, the checks in
`definition/AgentPlanBranchingGraph.ts`.

## Shape

Everything is an edge in `plan.edges`; the ports name what it means
(`planEdgeKind`):

| Edge      | From → to                              | Meaning                                                  |
| --------- | -------------------------------------- | -------------------------------------------------------- |
| flow      | `flow-out` → `flow-in`                 | unchanged: the target starts after the source            |
| condition | agent `passed-out` → decision `condition-in` | the decision reads the boolean result of the agent |
| branch    | decision `true-out`/`false-out` → `flow-in` | the activated output starts the target              |
| event     | agent/script `value-out` → agent `event-in` | the result returns to an agent as a new prompt      |

Flow, condition and branch edges order execution (`planOrderEdges`). Only the
event edge does not: it is the way back of a cycle, so `hasPlanPath`, the
cycle check and the flow numbering ignore it. An event edge must lead to a
node that runs before its source (`eventOrder`); a flow cycle stays refused.
Two more rules keep a round unambiguous. A node sends its result to **one**
event input (`eventFanout`): the target that starts again makes everything
behind it forget its start, so a second target would lose the news. And an
event may not return across another agent that receives events and lies on the
way (`eventNesting`): that agent would start again without the news it
expects. Two cycles one after the other are fine, nested ones are refused.

Not supported, and refused with a concrete reason: decisions, boolean results
and events inside groups or loops, and a group or loop behind an agent that an
event starts again, because it would not run again in the next round
(`branchBoundary`), on remote targets
(`branchRemote`), on non-ACP runners (`branchProvider`) and on agents with a
ticket work gate (`branchGate`). A decision needs exactly one condition and
both outputs connected before Play (`decisionCondition`, `decisionBranch`).

## The boolean result of an agent

An agent whose `passed-out` is connected reports `passed` with its result:

- `true`: the closing report is accepted (every todo done, every criterion met).
- `false`: the report is valid and its only findings are criteria that were not
  met or todos left open. The node itself succeeds; `false` is an answer.
- Anything else stays what it always was: a missing, unreadable, unproven or
  ticket-contradicted report, a blocked status or a technical failure fails the
  node (`plan_acceptance_failed` and friends). A `false` is never made up for a
  configuration or provider problem.

## Evaluating a decision

The scheduler evaluates a decision itself (no provider, no model) as soon as the
agent behind its condition has succeeded, and activates exactly one output.

- **Every activation reads a fresh value.** The decision remembers
  `source#start` of the value it read last and refuses to read the same start of
  the agent twice. Result: `condition = { sourceStepId, sourceActivation, value }`.
- **A missing or invalid input is not false.** If the agent failed, the decision
  waits behind it like any successor and the run fails with the agent's error.
  If the value is absent or was already read, the decision fails with
  `plan_decision_input_invalid`.
- **Dead paths.** The edge of the branch that was not taken is dead, and so is
  every edge out of a skipped node. A node whose every incoming edge is dead is
  `skipped` and spreads that along the branch; a node with at least one
  satisfied edge and no pending one is ready, so branches may meet again.
  Plans without a decision never skip anything. A group or loop behind the
  branch that was not taken is `skipped` as a whole (never `waiting`, which
  would fail the run), and a result binding to a node that was skipped fails
  the receiver with `plan_binding_invalid`: the bound node never produced one.

## Starting an agent again through its event input

When an agent behind an event edge has succeeded, its result is queued once per
start (`source#start>target`; a repeat is ignored). The target starts again when:

1. the target has succeeded before (an event before the first start cannot
   happen: the source lies behind the target), and
2. the target and everything behind it (`planRegion`) is settled: nothing runs,
   and nothing waits that can still start. A node of the round that has not
   run yet (a second fix behind the first, say) belongs to the round that is
   going on, so the target starts again after it and hears every sender once.
   A new round never overlaps an old one, and two writing agents never share a
   session.

Results that arrive together start the target **once**, with all of them, in the
order they arrived. Then the target and its region forget their last start:
each node with a start keeps a compact record in `history` (output shortened to
4000 characters, no session record), becomes `waiting` and is decided anew.
`activation` counts the starts of a node from 1; `trigger` names the senders.

- **Validation hint instead of a fake prompt.** If a sender's result holds
  nothing but its report, the target is not started and fails with
  `plan_event_prompt_empty` (or `plan_event_prompt_too_large` above 100000
  characters). No empty prompt, no replay of the main instruction, no `false`.
- **Limit.** A node starts at most `PLAN_ACTIVATION_LIMIT` (25) times per run.
  The return fails the target with `plan_activation_limit` as soon as the target
  or any node of its round has started that often, so no node of a cycle can
  exceed it.
- **A failure is never erased.** A result does not start its target when the
  target is blocked or failed, or when a node of the round failed (for example a
  second fix agent beside the one that succeeded). The waiting result is
  dropped and the run ends with that failure instead of hiding it in a new
  round.
- **Old results leave with their round.** When a round starts again, results
  that nodes of that round had queued are dropped with it; only fresh results
  of the new round can return.
- **Late results.** A result belongs to the start it was dispatched for; if the
  node began another start meanwhile, the late result is ignored (and logged).

## The session

An agent with an event input keeps its ACP session open after every start (like
a loop member that reuses its session) and closes it with the run, on failure
and on Stop. Its `session.event` record names the role of every start:

| Role        | When                                                                 | Prompt                                           |
| ----------- | -------------------------------------------------------------------- | ------------------------------------------------ |
| `created`   | first start                                                          | main instruction and inputs, as ever             |
| `continued` | the session is open (or a retry resumes it natively)                 | the news only, a follow-up turn in the same session |
| `recovered` | the session is no longer open (adapter exit)                         | NEW session: main instruction, inputs and the news, marked as new |

**Capacity.** A retained session keeps its lease while it waits for the news,
so a cycle needs two leases at once: the checker waits, the fix works. With the
default of two concurrent ACP sessions, two cycle runs at the same time can
hold both leases with their idle checkers; each fix then waits for capacity
until someone stops a run or raises the limit. Raise
`maxConcurrentAcpSessions` by two for every cycle run that has to run at the
same time. A process deadline of the agent
applies to a turn, not to the idle session: the session still takes the news.

A session counts as no longer open as soon as its closeout has begun
(`isClosing`), not only once its end is reported, so news
that arrives meanwhile starts a `recovered` session instead of reaching a
closing one. A `recovered` start ends the old session first and refuses to
start when its closeout cannot be confirmed (`plan_closeout_failed`); the
record of the earlier start, and its closeout, stays in place then. It never
takes another node's or another run's session: the session key is
`runId/nodeId`. A start that ended before its process began (cancelled while it
waited for capacity, then paused) leaves the key free, so Resume opens the
session instead of failing with `plan_group_session_lost`.
The report requirements are repeated with every turn, so the boolean result
stays valid for follow-ups. Retries of a technical session error (PAGE-191) work
as for any agent: a native resume continues the session; without one, a failed
first start opens a clean session and a failed follow-up start is `recovered`
(main instruction, inputs and the news in a new session). The session of an
agent with an event input is its own, so it is not treated as a shared session
that a retry must never replace.

## Persistence and recovery

- The run view keeps `activation`, `passed`, `branch`, `condition`, `trigger`
  and `history` per node (`readPlanActivationFields`), and the status `skipped`.
- The run repository keeps its guards for ordinary plans. A plan with a
  decision or event connection has a node without a checkpoint (the decision)
  and only the first completion of a node has one. Only a plan with an event
  connection lets a node settle more than once, so only there is a completed
  node no longer immutable; a plan with a decision alone keeps that guard.
- Such a run can only be **restarted**, never resumed from checkpoints
  (`branching_unsupported`). After a restart of the server nothing runs again
  by itself, as for every run.
- **Pause and resume.** Pausing a run during a cycle waits for the nodes that
  run. A result on its way back is queued while the run is pausing and its
  target is named in the pause boundary (`pendingStepIds`, `frontierStepIds`),
  so the run pauses instead of ending as succeeded. The retained session stays
  open; Resume starts the target again with that result as a follow-up prompt
  in the same session. A start that a pause ended before it began (it waited
  for capacity or was being prepared) is no start: it keeps its news for the
  resume and gives its count back. If the news of a started-again node is ever
  missing, the start fails with `plan_event_prompt_empty` instead of replaying
  the main instruction. The nodes that wait on keep their count of starts, their
  earlier starts and the event that started them (`keptStarts`), so a start is
  never counted twice, its result never collides with an earlier one, and the
  target never starts again without the news that caused it. Resume adopts the plan only in the revision the run
  started with: another revision is refused with `plan_branching_revision`,
  because the rounds behind a cycle cannot be compared with another plan.
- **Idle check.** Before a run is judged idle (and the retained sessions are
  closed), results that arrived since the last settle are settled in the same
  turn of the scheduler's queue. A fix agent that ends between two phases of a
  pump can therefore not close the session its result is about to continue.
- The Pica Mobile protocol has no state for a skipped node and no step for a
  decision, so both stay out of its dashboard.
- The Pages agent run record (`PageAgentRun`) of a node is written per run and
  node and the first completion wins; for a node that started again it holds
  its first start (prompt and result). Every start, with its result, branch and
  trigger, is in the run view's `history` and in the run view of the node.

## Known limits

Found in review and left as they are, with their consequence:

- A result binding (`{{name}}`) to a node on a branch that was not taken fails
  the receiver with `plan_binding_invalid`; the plan does not check that the
  bound node runs on every path to the receiver.
- A retained session keeps its capacity lease until the run ends, so a second
  cycle behind a finished one waits for capacity until that run ends. When all
  leases belong to sessions waiting for that very start, the run waits with the
  reason `capacity` until someone stops it or raises the limit.
- A start that raced the exit of the process in the few milliseconds between
  choosing `continued` and sending the follow-up fails with
  `plan_context_changed`; a new run is the way on. (The much longer window of
  the closeout itself is handled: `isClosing`.)
- A paused event target shows no session link in the editor until it starts.
- When the news of an event arrives while a retirement of the session is
  closing, the recovered start and the old session's late cleanup can race: the
  cleanup revokes the tool credential of the run and node, which the new session
  may already hold. The start itself is correct; its tool calls can then fail.
  This was found in review and not reproduced; a new run is the way on.
