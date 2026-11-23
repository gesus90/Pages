# Agent CLI

This inventory covers `backend/agents/cli`. Other directories below
`backend/agents` are not part of it. It was taken from the source tree of this
revision and records what exists; it makes no claim about test or coverage
results.

## Current state

- The [backend suite](BackendTesting.md) selects tests and requires per-file
  coverage for this area. The inventory below records the source scope.
- The directory holds 62 `.ts` modules and nothing else: no `.mjs` module and
  no Markdown file. 60 modules are executable; 2 are declarative.
- A read-through of the isolation gate, the redaction, the pausable deadline
  and the isolation mounts found no defect that could be shown without running
  code, so no source module was changed.

## Executable modules

The boundary column was derived from the imports of each module. It names what
a test has to control; it is confirmed or corrected when the tests are written.
"Scheduler and tools" means the ACP resource scheduler, the tool manager,
registry and session of `backend/service/agents`.

| Module                         | Boundary a test controls                                                                 |
| ------------------------------ | ---------------------------------------------------------------------------------------- |
| `AgentCliRuntime.ts`           | logger, abort signal, secret cipher, agent connection rows, tool manager                 |
| `AgentCredentialStore.ts`      | file system, logger                                                                      |
| `AgentSharedEnvironment.ts`    | child process (`execFile`), file system, timers and clock                                |
| `AntigravityCli.ts`            | file system, logger, abort signal                                                        |
| `AntigravityContextBinding.ts` | file system                                                                              |
| `AntigravityLoginRedirect.ts`  | loopback HTTP server, random IDs and hashes, abort signal                                |
| `AntigravityProtocol.ts`       | random IDs and hashes, abort signal, line channel                                        |
| `AntigravityUsageResult.ts`    | none, pure                                                                               |
| `ClaudeCodeCli.ts`             | logger, abort signal                                                                     |
| `ClaudePlanSessionHome.ts`     | file system, random IDs and hashes                                                       |
| `ClaudeUsageResult.ts`         | none, pure                                                                               |
| `CliAcpLaunch.ts`              | abort signal                                                                             |
| `CliAcpProtocol.ts`            | none, pure                                                                               |
| `CliAcpRedaction.ts`           | none, pure                                                                               |
| `CliAcpSessionSetup.ts`        | child process (`spawn`), abort signal, scheduler and tools                               |
| `CliAcpStartCleanup.ts`        | logger                                                                                   |
| `CliAssetWorkspace.ts`         | file system, streams, random IDs and hashes                                              |
| `CliChildProcess.ts`           | child process (`spawn`), timers and clock, logger                                        |
| `CliEnvironment.ts`            | process environment                                                                      |
| `CliGitBridge.ts`              | child process, network sockets, file system, timers and clock, logger                    |
| `CliGitBridgePolicy.ts`        | random IDs and hashes                                                                    |
| `CliGitHubCredentials.ts`      | file system, random IDs and hashes, logger, GitHub access                                |
| `CliGitPublishScript.ts`       | none, pure (script text)                                                                 |
| `CliHostMcpServers.ts`         | file system, process environment, logger                                                 |
| `CliIsolationGate.ts`          | logger                                                                                   |
| `CliLocator.ts`                | file system, process environment, logger                                                 |
| `CliLoginParser.ts`            | logger                                                                                   |
| `CliModelCatalog.ts`           | logger                                                                                   |
| `CliNamespaceControl.ts`       | child process (`execFile`), process signals, file system                                 |
| `CliNamespacePause.ts`         | child process (`execFile`)                                                               |
| `CliNativeHost.ts`             | child process (`execFile`), process environment and platform, abort signal               |
| `CliOwnedNamespace.ts`         | child process, process signals, file system, timers and clock                            |
| `CliPausableDeadline.ts`       | timers and clock                                                                         |
| `CliPicaSessionSetup.ts`       | logger                                                                                   |
| `CliPlanIsolation.ts`          | child process (`execFile`), file system, timers and clock, logger                        |
| `CliPlanTemporaryDirectory.ts` | file system                                                                              |
| `CliProcessRunner.ts`          | child process (`spawn`), process signals, logger                                         |
| `CliProcessScan.ts`            | file system (`/proc`), timers and clock, logger                                          |
| `CliResultParser.ts`           | logger                                                                                   |
| `CliSessionChannel.ts`         | abort signal, line channel                                                               |
| `CliSessionChecks.ts`          | abort signal, Playwright session                                                         |
| `CliSessionCloseout.ts`        | timers and clock, logger                                                                 |
| `CliSessionEvents.ts`          | logger                                                                                   |
| `CliSessionExecution.ts`       | child process (`spawn`), abort signal, logger, scheduler and tools                       |
| `CliSessionPlans.ts`           | none, pure                                                                               |
| `CliSessionProcess.ts`         | child process (`spawn`), timers and clock, abort signal, logger                          |
| `CliSshConfigOverlay.ts`       | file system, random IDs and hashes, logger                                               |
| `CliToolExecution.ts`          | timers and clock, abort signal                                                           |
| `CliUsageHome.ts`              | file system, random IDs and hashes, logger                                               |
| `CliWorkerUnit.ts`             | child process (`execFile`), file system, timers and clock, random IDs and hashes, logger |
| `CliWorkerUnitJournal.ts`      | child process (`execFile`)                                                               |
| `CodexCli.ts`                  | abort signal                                                                             |
| `CodexUsageResult.ts`          | quota repository                                                                         |
| `OpenCodeAgentModel.ts`        | none, pure                                                                               |
| `OpenCodeCli.ts`               | abort signal, secret cipher                                                              |
| `OpenCodeCredentialStore.ts`   | file system, random IDs and hashes, logger, secret cipher                                |
| `OpenCodeCredentials.ts`       | file system, logger                                                                      |
| `OpenCodeSessionUsage.ts`      | SQLite file of OpenCode (`node:sqlite`), file system                                     |
| `PicaCodexBundle.ts`           | file system, random IDs and hashes                                                       |
| `PicaNativeArtifact.ts`        | file system, random IDs and hashes                                                       |

`CliSessionExecution.ts` (685 lines), `CliGitHubCredentials.ts` (643 lines) and
`CliWorkerUnit.ts` (630 lines) are the largest modules. The line counts include
comments and blank lines, so they are not the code-line figure that the
`max-lines` rule counts.

## Not applicable

These modules have no executable statements of their own. Coverage reports
them as `n/a` (0/0), not as covered.

- `CliContracts.ts` declares only types and interfaces.
- `OpenCodeVersion.ts` only re-exports `SUPPORTED_OPENCODE_VERSION` and
  `isSupportedOpenCodeVersion` from `definition/OpenCodeVersion`; the behavior
  belongs to that module. Whether the coverage tool counts the re-export as a
  statement is confirmed when it is measured.

## Code that coverage cannot measure

- `PicaCodexBundle.ts` imports `PicaCodexGlueRuntime.mjs` from the ACP
  directory as a raw string and writes it into a bundle. A unit test can check
  the bundle files and their hashes; the glue code runs in the Codex adapter
  process and is part of the ACP inventory.
- The modules that start, signal and scan real processes (`CliChildProcess.ts`,
  `CliProcessRunner.ts`, `CliSessionProcess.ts`, `CliOwnedNamespace.ts`,
  `CliNamespaceControl.ts`, `CliNamespacePause.ts`, `CliWorkerUnit.ts`,
  `CliProcessScan.ts`) and the bubblewrap mounts of `CliPlanIsolation.ts` can be
  unit-tested only against a faked `spawn`, `execFile`, signal function and
  `/proc` tree. The behavior on a real host (mount namespace, process groups,
  systemd worker units, the loopback Git bridge and the SSH configuration
  overlay) stays an operating check.
- The patches `backend/agents/codex-patch/pages-tool-policy.patch` (4029 lines)
  and `backend/agents/opencode-patch/pages-pica.patch` (322 lines) with their
  manifests lie outside this directory. They are not executable here, the
  manifests give the status `experimental-unbuilt`, no unit test covers them,
  and they need a build and an operating check of the patched binaries. They
  belong to no module coverage figure.

## Observations

- `CliPlanIsolation.ts` falls back to `/tmp/pages-ssh-config-<uid>` for the
  immutable SSH configuration copies when a request has no temporary
  directory. The project rule asks for `~/.pages/tmp` through
  `pagesTempDirectory()`. The fallback lies outside the writable `/tmp` mount
  of the sandbox on purpose and nothing is known to fail; moving it changes the
  isolation layout and is left to a task that can test it.
- `OpenCodeSessionUsage.ts` reads the SQLite file of OpenCode with
  `node:sqlite`. It is not a Pages runtime database; a test uses a temporary
  file, never a live OpenCode data folder.

## Open work

- Behavior tests for each executable module above: start and completion of a
  session, isolation and its refusal, process failures and signals,
  environments, handling and masking of secrets (credential stores, GitHub
  credentials, redaction) and session events.
- The earlier coverage sections keep their own evidence; this inventory does not
  re-verify them.
- Unit tests will not prove integration, process or operating behavior of the
  CLI agents, the mount namespace, the worker units or the patched binaries
  inside a running instance.
