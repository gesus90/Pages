# Agent base modules

This inventory covers the files directly in `backend/agents`, without any
subdirectory. The subdirectories `acp`, `catalog`, `cli`, `local`, `providers`,
`runtime` and `simulation` have their own inventories. It was taken from the
source tree of this revision and records what exists; it makes no claim about
test or coverage results.

## Current state

- No test file exists in this directory. Two test files elsewhere touch modules
  of it incidentally:
  `backend/service/agents/AgentPlanRunControl.test.ts` imports
  `AgentPlanRecoveryInput.ts` and `AgentPlanSessionInput.ts`, and
  `backend/service/runner/RunnerManagedRecovery.test.ts` imports
  `AgentPlanScriptRunInput.ts`. Neither tests the behavior of those modules as
  its own subject.
- The directory is not part of `BACKEND_COVERAGE_SECTIONS` in
  `vitest.backend.config.ts`. Adding it without tests would make the per-file
  coverage thresholds of 100% fail, so the configuration stays unchanged until
  the tests exist.
- No coverage was measured for these modules. No coverage figure is claimed.
- The directory holds 45 `.ts` files and nothing else: no `.mjs` module, no
  Markdown file and no patch. 42 modules are executable; 3 are declarative.
- A read-through of the input readers, the dispatch fence, the provider failure
  classification and the temporary directory handling found one defect that
  needs a decision (see Observations). No source module was changed.

## Executable modules

The boundary column was derived from the imports of each module. It names what
a test has to control; it is confirmed or corrected when the tests are written.
"Input reader" means a module that narrows an untrusted payload to a typed
value and throws an `AgentError` or a comparable error for invalid input.

| Module                            | Boundary a test controls                                      |
| --------------------------------- | ------------------------------------------------------------- |
| `AgentCheckDetail.ts`             | none, pure (sanitizes a check detail)                         |
| `AgentConfigurationInput.ts`      | none, pure input reader                                       |
| `AgentPayload.ts`                 | none, pure                                                    |
| `AgentPlanActivationInput.ts`     | none, pure input reader                                       |
| `AgentPlanAgentTodoInput.ts`      | none, pure input reader                                       |
| `AgentPlanAssetInput.ts`          | none, pure input reader                                       |
| `AgentPlanCleanupFailureInput.ts` | none, pure input reader                                       |
| `AgentPlanCloneShape.ts`          | none, pure                                                    |
| `AgentPlanConfigurationInput.ts`  | none, pure input reader                                       |
| `AgentPlanContentDigest.ts`       | none, pure (SHA-256 of JSON)                                  |
| `AgentPlanContinuationInput.ts`   | none, pure input reader                                       |
| `AgentPlanDecisionInput.ts`       | none, pure input reader                                       |
| `AgentPlanDispatchFence.ts`       | none, pure (plan run and runner binding as data)              |
| `AgentPlanExecution.ts`           | logger, abort signal, ACP chat session, cleanup errors        |
| `AgentPlanInput.ts`               | none, pure input reader                                       |
| `AgentPlanJumpInput.ts`           | none, pure input reader                                       |
| `AgentPlanLoopInput.ts`           | none, pure input reader                                       |
| `AgentPlanLoopRunInput.ts`        | none, pure input reader                                       |
| `AgentPlanProgressInput.ts`       | none, pure input reader                                       |
| `AgentPlanRecoveryInput.ts`       | none, pure input reader                                       |
| `AgentPlanRetryInput.ts`          | none, pure input reader                                       |
| `AgentPlanRunInput.ts`            | none, pure input reader                                       |
| `AgentPlanRunResources.ts`        | none, pure input reader                                       |
| `AgentPlanScriptRunInput.ts`      | none, pure input reader                                       |
| `AgentPlanSessionInput.ts`        | none, pure input reader                                       |
| `AgentPlanSettingsInput.ts`       | none, pure input reader                                       |
| `AgentPlanStackRunInput.ts`       | none, pure input reader                                       |
| `AgentPlanStartRejectionInput.ts` | none, pure input reader                                       |
| `AgentPlanStepReportInput.ts`     | none, pure (zod schema)                                       |
| `AgentPlanStepResultInput.ts`     | none, pure input reader                                       |
| `AgentPlanStepTickets.ts`         | none, pure                                                    |
| `AgentPlanSwarmInput.ts`          | none, pure input reader                                       |
| `AgentPlanTemplateInput.ts`       | none, pure input reader                                       |
| `AgentPlanWorkInput.ts`           | none, pure input reader                                       |
| `AgentProviderFailure.ts`         | none, pure (classifies error data and provider reset hints)   |
| `AgentSessionFailure.ts`          | none, pure                                                    |
| `AgentWorkspaceInput.ts`          | none, pure input reader                                       |
| `AgentWorkspaceReferences.ts`     | none, pure                                                    |
| `PageAgentRecordInput.ts`         | none, pure input reader                                       |
| `PlanRunTemporaryDirectory.ts`    | file system (`node:fs/promises`), home directory, process uid |
| `SystemdServiceEnvironment.ts`    | none, pure                                                    |
| `TicketAssetInput.ts`             | injected asset reader                                         |

`AgentPlanInput.ts` (659 lines), `AgentPlanSessionInput.ts` (456 lines) and
`AgentPlanExecution.ts` (377 lines) are the largest modules. The line counts
include comments and blank lines, so they are not the code-line figure that the
`max-lines` rule counts.

## Not applicable

These modules have no executable statements of their own. Coverage reports
them as `n/a` (0/0), not as covered.

- `ConversationSessionRunner.ts` declares only interfaces and a type alias for
  the conversation session contract.
- `ScopedExecution.ts` declares only the `ExecutionAuthorizer` interface.
- `TextExecution.ts` declares only the `TextExecutionInput` and `TextExecution`
  interfaces.

## Patches and their operating check

The two patch directories are subdirectories of `backend/agents`, so they are
outside the module scope above. They are recorded here because they are not
executable and no unit test can cover them. The `LICENSE` files belong to the
upstream projects.

| File                                                  | Lines | Manifest status        |
| ----------------------------------------------------- | ----- | ---------------------- |
| `codex-patch/pages-tool-policy.patch` (Codex 0.160.0) | 4029  | `experimental-unbuilt` |
| `opencode-patch/pages-pica.patch` (OpenCode 1.18.34)  | 322   | `experimental-unbuilt` |

- The SHA-256 of each patch file and each `LICENSE` file equals the value in
  its `manifest.json` at this revision (compared with `sha256sum`). The
  `binarySha256` of both manifests is `null`: no patched binary is recorded.
- A patch is proved only by applying it to the upstream commit named in its
  manifest, building the binary and running it in an instance. None of this is
  done by a unit test and none of it was done for this inventory.

## Code that coverage cannot measure

- `PlanRunTemporaryDirectory.ts` checks the file system type with `statfs` and
  the owner with `lstat`. A unit test can use a temporary home directory and a
  faked `statfs` result; whether a real host refuses `tmpfs` and `ramfs` stays an
  operating check.
- `AgentPlanExecution.ts` wraps a real ACP session. A unit test can drive it
  with a fake chat object; the behavior of a running agent process belongs to
  the ACP and CLI inventories and to operating checks.

## Observations

- `temporaryPlanRunIds()` in `PlanRunTemporaryDirectory.ts` decodes each
  directory name below the run scratch root with `decodeURIComponent`. A
  directory that Pages did not create and whose name is not valid
  percent-encoding (for example `%zz`) throws a `URIError`
  (`decodeURIComponent("%zz")` was run in Node to confirm this). The only
  caller, `AgentPlanTemporaryCleanup.ts`, would then fail the startup
  reconciliation. Whether such a name should be skipped or removed is a
  decision for a task that also covers the cleanup service; the module is left
  unchanged here.

## Open work

- Behavior tests for each executable module above: valid and invalid payloads
  of every input reader (limits, unknown keys, wrong types), the dispatch fence
  for stale, paused, stopped and retained-instruction runs, provider failure
  and reset classification, temporary directory identifiers, ownership and file
  system refusals, and the ticket asset reader without a live reader. The
  coverage section is added to `vitest.backend.config.ts` in the same change.
- The earlier coverage sections keep their own evidence; this inventory does not
  re-verify them.
- Unit tests will not prove integration, process or operating behavior, the
  scratch directories on a real host or the patched binaries inside a running
  instance.
