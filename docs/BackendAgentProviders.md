# Agent providers

This inventory covers `backend/agents/providers`. Other directories below
`backend/agents` are not part of it.

## Current state

- The [backend suite](BackendTesting.md) selects tests and requires per-file
  coverage for this area. The inventory below records the source scope.
- The directory contains no `.mjs` module or patch file.

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
  and response mapping, invalid input, provider errors, timeouts and aborts.
- The earlier coverage sections keep their own evidence; this inventory does not
  re-verify them.
- Unit tests will not prove integration, process or operating behavior of the
  provider calls against real vendors inside a running instance.
