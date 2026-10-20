# Loop node (PAGE-122)

A `loop` plan node repeats a subgraph of agent and script nodes. This file is
the contract of its behaviour; the types live in `definition/AgentPlanLoop.ts`
and `definition/AgentPlanLoopRun.ts`.

## Shape

- One flow node in the outer graph (entry `flow-in`, exit `flow-out`). The
  outer graph stays acyclic; the loop repeats its own subgraph, never outer
  nodes. Members are agents and scripts with their own internal flow edges.
  Members without an internal predecessor are the entries, members without a
  successor the exits.
- **Not supported:** loops inside loops, groups inside loops, flow edges and
  result bindings across the loop border (outer value sources such as
  parameters, tickets and variables may still feed members). The server
  refuses them: `plan_loop_nested` for loops/groups inside a loop,
  `loopBoundary` for a border crossing.
- A group stays a portless session container and has no loop counter.

## Count

- `runs`: whole number 1 to 999, default 1, fixed value or the value of a
  bound parameter node (`bindings.runs`). A parameter text counts only as
  plain decimal digits (`^[1-9][0-9]{0,2}$` after trimming); nothing is
  rounded, cut or replaced by the saved number. The count is resolved once
  before the first iteration and stored with the run (`AgentPlanLoopRun.count`);
  a later change of the parameter or the plan does not move it.
- `countMode`: `max` runs at most N iterations and may end earlier through its
  condition; `expected` runs exactly N and ignores the condition.
- A regular end never pauses or fails the run. Completion reasons:
  `count_reached` (N complete iterations) and `condition_met` (`max` only).
  Errors, timeouts, a lost session, an unconfirmed cleanup and Stop stay
  effective in both modes.

## End condition (`max` only)

`{ isEnabled, sourceNodeId, outputPath, operator: "equals", expected }` with a
typed expected value (`boolean`, `number`, `string`, `null`). The path is `$`
followed by `.name` and `[index]` segments (at most 8, e.g. `$.end`,
`$.review.end`, `$.items[0].done`); no wildcard, filter or code.

Output contract of the source node (agent answer or script output):

1. the whole answer is one JSON value, or
2. the answer contains exactly one fenced block marked `pages-loop-result`
   holding one JSON value; text around it is ignored.

No block and no whole-answer JSON is `plan_loop_output_missing`, several blocks
`plan_loop_output_ambiguous`, an invalid block `plan_loop_output_invalid`.
`pages-report` blocks and other fences are never read as a result. A missing
field is `plan_loop_condition_field`; a value of another type than the expected
one (`"true"` for boolean `true`, a number, `null`, an object) is
`plan_loop_condition_type`, never a silent `false`. The condition is evaluated
after every complete iteration, also the last one; a failure is a failure
even when N is reached. In `expected` mode, or with the condition switched
off, it is `not_evaluated`.

## Sessions

- `sessionPolicy: "reuse"`: every agent node owns one ACP session per run,
  keyed `runId/loopId/nodeId` (the iteration is no part of it), opened in the
  first iteration and continued with a new turn in every further one by the
  existing `AgentPlanGroupSessions` layer (turn queue, runtime fingerprint,
  `plan_group_session_lost` instead of a silent second session, reported as
  `plan_loop_session_lost`). Requires ACP agents (`loopProvider` otherwise).
  Sessions end with the loop: before it reports success (so successors start
  after a confirmed cleanup), on failure and on Stop. A Pause keeps them.
- `sessionPolicy: "fresh"`: each iteration opens a new session per agent and
  ends it with the node; only bound inputs carry over.
- The run records the Pages run, loop and node IDs, the iteration, the ACP
  session ID the adapter issued, a native ID only if an adapter reports one
  separately, and the process instance — never an invented ID.

## Results between iterations

An input of a member can be bound to `previous`: the result that a member had
in the previous iteration (`{ kind: "previous", stepId }`). Only that single
newest result is handed over, so prompts do not grow. The first iteration has
no such result; the input then uses its own default value, which the plan
check requires (`loopPrevious`). Every iteration keeps its own results.

## Scripts

Top-level script steps execute through the [PAGE-123 script runtime](../ScriptRuntime.md).
Script members inside loops remain stored but are refused specifically with
`loopScriptUnsupported`. Loop script execution is outside PAGE-123; the member
runner retains its defensive refusal instead of skipping saved work.

## Persistence

The run view (`agent_plan_runs.view_json`) holds `loops` with every iteration,
the count source, effective N, mode, condition verdicts, sessions, completion
reason and cleanup. Each completed iteration is also written once, in the same
transaction, to `agent_plan_loop_iterations` (migration 064) and may not
change afterwards. After a restart an unfinished iteration is reported as
failed `plan_interrupted`, open sessions as `lost`; nothing runs again.
