# Agent providers

This inventory covers `backend/agents/providers`. Other directories below
`backend/agents` are not part of it.

## Current state

- No test file exists for any module of this directory, and no test file
  anywhere imports them.
- The directory is not part of `BACKEND_COVERAGE_SECTIONS` in
  `vitest.backend.config.ts`. Adding it without tests would make the per-file
  coverage thresholds of 100% fail, so the configuration stays unchanged until
  the tests exist.
- No coverage was measured for these modules. No coverage figure is claimed.
- The directory contains no `.mjs` module, no patch file and no purely
  declarative file.

## Executable modules

| Module                      | Boundary a test controls                                       |
| --------------------------- | -------------------------------------------------------------- |
| `AnthropicProvider.ts`      | injected `ProviderHttpClient`, abort signal                    |
| `ApiProviderRegistry.ts`    | none, builds the adapters                                      |
| `ApiTextExecution.ts`       | injected `fetch`, connection repository, secret cipher, signal |
| `GoogleAiStudioProvider.ts` | injected `ProviderHttpClient`, abort signal                    |
| `OpenAiProvider.ts`         | injected `ProviderHttpClient`, abort signal                    |
| `OpenRouterProvider.ts`     | injected `ProviderHttpClient`, abort signal                    |
| `ProviderErrors.ts`         | none, pure                                                     |
| `ProviderHttpClient.ts`     | injected transport (`fetch`), abort signal, logger             |
| `ProviderImageClients.ts`   | injected `fetch`, abort signal, logger                         |
| `ProviderMediaClients.ts`   | injected `fetch`, abort signal                                 |
| `ProviderMediaTransport.ts` | injected `fetch`, abort signal, timers, logger                 |
| `ProviderReset.ts`          | injected clock (`now` argument; `Date.now` otherwise)          |
| `ProviderResponses.ts`      | none, pure                                                     |
| `TextProviderPayload.ts`    | none, pure                                                     |
| `TicketAssetPayload.ts`     | none, pure                                                     |

## Not applicable

`ProviderContracts.ts` declares only types and interfaces and has no
executable statements. Coverage reports it as `n/a` (0/0), not as covered.

## Open work

- Behavior tests for each executable module above: provider selection, request
  and response mapping, invalid input, provider errors, timeouts and aborts,
  with the coverage section added to `vitest.backend.config.ts` in the same
  change.
- The earlier coverage sections keep their own evidence; this inventory does not
  re-verify them.
- Unit tests will not prove integration, process or operating behavior of the
  provider calls against real vendors inside a running instance.
