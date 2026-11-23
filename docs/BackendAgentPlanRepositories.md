# Agent plan definition and access repositories

This inventory covers 13 modules directly in
`backend/database/repositories/agent/`: the repositories and helpers for plan
definitions, sharing, team rights, templates, referenced resources and
persistence errors. It was taken from the source tree of this revision and
records what exists; it makes no claim about test or coverage results.

## Current state

- All 13 modules are executable. None consists only of type declarations or
  named re-exports, so none is exempt from measurement.
- No test file exists for them yet. The other files of the directory
  (`AgentPlanRestartRetirement.test.ts` and the modules not listed here) belong
  to other areas and are not part of this inventory.
- The modules are not yet selected by `BACKEND_COVERAGE_SECTIONS` in
  `vitest.backend.config.ts`. A section needs its test files first: without
  them the per-file coverage report would reject every module as missing a
  measurement. Add the section together with its tests.

## Executable modules

The boundary column was derived from the imports of each module. It names what
a test has to control. "Executor" means the `Database` or `DatabaseTransaction`
passed in by the caller; it is mocked, so no PostgreSQL instance is needed.

| Module                                 | Responsibility                                        | Boundary a test controls                                         |
| -------------------------------------- | ----------------------------------------------------- | ---------------------------------------------------------------- |
| `AgentPlanAccessRepository.ts`         | plan access changes and sharing                       | executor, audit, script approval and team repositories, notifier |
| `AgentPlanAuditRepository.ts`          | plan audit entries                                    | executor, `node:crypto` identifiers                              |
| `AgentPlanChangeNotification.ts`       | live change notification and event outbox             | transaction, event outbox repository                             |
| `AgentPlanDeletionGuard.ts`            | refuses deletion while resources are held             | transaction                                                      |
| `AgentPlanOneShotRepository.ts`        | one-shot scheduling, cancel, due list and deletion    | executor, project activity repository, notifier                  |
| `AgentPlanRemoteAccessRepository.ts`   | writes the remote access setting of a plan            | executor                                                         |
| `AgentPlanRepository.ts`               | plan definitions, clone source, legacy shares, remove | executor, deletion guard, stored references, team repository     |
| `AgentPlanScriptApprovalRepository.ts` | lists and records plan script approvals               | executor                                                         |
| `AgentPlanStoredReferences.ts`         | checks connections and remote models of a plan        | transaction, `AgentError`                                        |
| `AgentPlanTeamRepository.ts`           | reads and replaces the team rights of plans           | executor, `AgentError`                                           |
| `AgentPlanTemplateRepository.ts`       | node templates: list, find, create, update, remove    | executor, workspace references repository                        |
| `AgentPlanWorkspaceRepository.ts`      | reads the registered workspace ids                    | executor                                                         |
| `PlanBridgeGrantRepository.ts`         | inserts, finds, deletes and revokes bridge grants     | executor                                                         |

## Behaviors a test has to cover

- Definitions: listing, finding, clone source, saving with the revision check
  (`requirePlanRevision`), the legacy share outcomes `shared`, `collision` and
  `settled`, keeping a one-shot plan and removal.
- Sharing and team rights: access changes, team reads for one and for all
  plans, replacing a team, audit entries appended with each change.
- One-shot plans: scheduling, cancelling, due listing and deletion.
- Templates: list, find, create, update and remove, including the journal and
  scope handling.
- Referenced resources: missing connections or remote models and a run that
  still holds a native owner or writer lock raise an `AgentError`; released
  resources pass.
- Persistence errors: an executor that rejects propagates the error and no
  notification is recorded for a failed write.
