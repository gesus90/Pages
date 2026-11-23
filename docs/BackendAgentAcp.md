# Agent ACP

This inventory covers `backend/agents/acp`. Other directories below
`backend/agents` are not part of it. It was taken from the source tree of this
revision and records what exists; it makes no claim about test or coverage
results.

## Current state

- No test file exists for any module of this directory, and no test file
  anywhere imports them.
- The directory is not part of `BACKEND_COVERAGE_SECTIONS` in
  `vitest.backend.config.ts`. Adding it without tests would make the per-file
  coverage thresholds of 100% fail, so the configuration stays unchanged until
  the tests exist.
- No coverage was measured for these modules. No coverage figure is claimed.
- The directory holds 50 `.ts` modules, 2 `.mjs` modules and 4 `.md` files.
  47 `.ts` modules and both `.mjs` modules are executable; 3 `.ts` modules and
  the 4 `.md` files are declarative.
- A read-through of the protocol, handshake, permission, turn-control, usage
  and quota modules found no defect that could be shown without running code,
  so no source module was changed.

## Executable modules

The boundary column was derived from the imports of each module. It names what
a test has to control; it is confirmed or corrected when the tests are written.

| Module                          | Boundary a test controls                                                                |
| ------------------------------- | --------------------------------------------------------------------------------------- |
| `AcpChat.ts`                    | logger, ACP connection or client                                                        |
| `AcpConfigOptions.ts`           | none, pure                                                                              |
| `AcpDrivers.ts`                 | none, pure                                                                              |
| `AcpEvents.ts`                  | none, pure                                                                              |
| `AcpLaunch.ts`                  | none, pure                                                                              |
| `AcpLineChannel.ts`             | logger                                                                                  |
| `AcpMcpReadiness.ts`            | timers and clock, ACP connection or client                                              |
| `AcpMcpStatus.ts`               | none, pure                                                                              |
| `AcpPermissions.ts`             | none, pure                                                                              |
| `AcpPicaSupport.ts`             | none, pure                                                                              |
| `AcpPlanActivity.ts`            | none, pure                                                                              |
| `AcpPromptBudget.ts`            | logger                                                                                  |
| `AcpProtocolClose.ts`           | timers and clock, logger, abort signal, ACP connection or client                        |
| `AcpSession.ts`                 | timers and clock, logger, abort signal, ACP connection or client                        |
| `AcpSessionConfiguration.ts`    | logger, abort signal, ACP connection or client                                          |
| `AcpSessionHandshake.ts`        | logger, abort signal, ACP connection or client                                          |
| `AcpSessionLifecycle.ts`        | logger, abort signal, ACP connection or client                                          |
| `AcpSessionOutcome.ts`          | logger, abort signal                                                                    |
| `AcpSessionPermission.ts`       | logger                                                                                  |
| `AcpSessionToolLogging.ts`      | logger                                                                                  |
| `AcpTicketAssets.ts`            | none, pure                                                                              |
| `AcpTurnControl.ts`             | timers and clock, abort signal                                                          |
| `AntigravityAcpDriver.ts`       | none, pure                                                                              |
| `AntigravityAcpLaunch.ts`       | none, pure                                                                              |
| `AntigravityConfiguration.ts`   | file system                                                                             |
| `AntigravityTurnFailure.ts`     | abort signal                                                                            |
| `ClaudeAcpAdapter.ts`           | none, pure                                                                              |
| `ClaudeAcpDriver.ts`            | none, pure                                                                              |
| `ClaudeAcpProfile.ts`           | none, pure                                                                              |
| `ClaudeAcpQuota.ts`             | logger, ACP connection or client                                                        |
| `ClaudeAcpUsage.ts`             | logger, ACP connection or client                                                        |
| `CodexAcpAdapter.ts`            | none, pure                                                                              |
| `CodexAcpConfigurationGuard.ts` | file system, logger                                                                     |
| `CodexAcpDriver.ts`             | none, pure                                                                              |
| `CodexAcpProfile.ts`            | none, pure                                                                              |
| `CodexThreadUsage.ts`           | file system, timers and clock, logger                                                   |
| `OpenCodeAcpConfiguration.ts`   | file system, logger                                                                     |
| `OpenCodeAcpDriver.ts`          | random IDs and hashes                                                                   |
| `OpenCodeAcpErrors.ts`          | none, pure                                                                              |
| `OpenCodeAcpProfile.ts`         | none, pure                                                                              |
| `PicaClaudeHelper.ts`           | none, pure                                                                              |
| `PicaClaudeHelperRuntime.mjs`   | file system, injected `fetch`, timers and clock, random IDs and hashes, abort signal    |
| `PicaClaudeHelperScript.ts`     | none, pure                                                                              |
| `PicaCodexAdapterPatch.ts`      | file system, random IDs and hashes, ACP connection or client                            |
| `PicaCodexGlueRuntime.mjs`      | timers and clock                                                                        |
| `PicaCodexInjected.ts`          | timers and clock, ACP connection or client                                              |
| `PicaCodexProtocol.ts`          | none, pure                                                                              |
| `PicaCodexRegistration.ts`      | abort signal, ACP connection or client                                                  |
| `PicaCodexRequests.ts`          | timers and clock, random IDs and hashes, logger, abort signal, ACP connection or client |

`AcpSession.ts` (694 lines) is the largest module and orchestrates the others;
its handshake, lifecycle, outcome, permission and configuration parts live in
the `AcpSession*.ts` modules above.

## Not applicable

These modules declare only types and interfaces and have no executable
statements. Coverage reports them as `n/a` (0/0), not as covered.

- `AcpDriver.ts`
- `AcpSessionContracts.ts`
- `PicaCodexGlue.ts`

These Markdown files are documentation of the verified adapter contracts and
have no executable statements:

- `ClaudeAcpCapabilities.md`
- `CodexAcpCapabilities.md`
- `OpenCodeAcpCapabilities.md`
- `AntigravityAcpCapabilities.md`

## Code that coverage cannot measure

- `PicaCodexInjected.ts` exports one template string. Its content is
  JavaScript that `PicaCodexAdapterPatch.ts` writes into the pinned Codex
  adapter and that runs inside the adapter process. A unit test can check the
  string that `patchPicaCodexAdapter` produces (pinned version and hash
  checks, single replacements); it cannot execute the injected code with
  instrumentation. The injected code needs an operating check against the
  pinned adapter.
- `PicaClaudeHelperRuntime.mjs` and `PicaCodexGlueRuntime.mjs` are plain
  modules that run in separate processes, the first as the helper script of
  Claude Code (`PicaClaudeHelperScript.ts` prepends its interpreter line). A
  test imports or spawns them against controlled files and a fake HTTP target;
  the process behavior stays an operating check.
- The patches `backend/agents/codex-patch/pages-tool-policy.patch` and
  `backend/agents/opencode-patch/pages-pica.patch` with their manifests lie
  outside this directory. They are not executable here (the Codex manifest
  says `experimental-unbuilt`), are not covered by any unit test and need a
  build and an operating check of the patched binaries.

## Observations

- `PicaClaudeHelperRuntime.mjs` writes image files to `/tmp/pages-pica-images`,
  and `PicaClaudeHelper.ts` accepts only that path. The project rule asks for
  `~/.pages/tmp` through `pagesTempDirectory()`. Both writer and reader run on
  the agent side of the host, so the files are visible to both and nothing is
  known to fail; moving the folder changes the helper contract in both files
  and is left to a task that can test it.

## Open work

- Behavior tests for each executable module above: protocol and line channel,
  handshake and capability negotiation, session lifecycle and close, turn
  control and interruption, permission decisions, driver and profile selection
  per provider, usage and quota readings, and error paths, with the coverage
  section added to `vitest.backend.config.ts` in the same change.
- The earlier coverage sections keep their own evidence; this inventory does not
  re-verify them.
- Unit tests will not prove integration, process or operating behavior of the
  ACP adapters, the injected Codex code or the patched binaries inside a
  running instance.
