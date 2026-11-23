# Agent catalog, runtime and simulation

This inventory covers `backend/agents/catalog`, `backend/agents/runtime` and
`backend/agents/simulation`. Other directories below `backend/agents` are not
part of it.

## Current state

- The [backend suite](BackendTesting.md) selects tests and requires per-file
  coverage for this area. The inventory below records the source scope.
- The directories contain no `.mjs` module and no patch file.

## Executable modules

| Module                                        | Boundary a test controls                      |
| --------------------------------------------- | --------------------------------------------- |
| `catalog/CatalogDefaults.ts`                  | none, pure                                    |
| `catalog/CatalogHttpClient.ts`                | injected `fetch`, abort signal, logger        |
| `catalog/CatalogParsing.ts`                   | none, pure                                    |
| `catalog/CatalogProviderClient.ts`            | injected `CatalogHttpClient`                  |
| `catalog/CatalogTextModels.ts`                | none, pure                                    |
| `catalog/DocumentedReasoningLevels.ts`        | none, pure                                    |
| `runtime/RuntimeExecutionContext.ts`          | injected session service, abort signal        |
| `runtime/RuntimeToolRegistry.ts`              | tool handlers, administrator gate, observers  |
| `simulation/AgentSimulationMode.ts`           | injected environment, logger, console         |
| `simulation/AgentSimulationModels.ts`         | none, pure                                    |
| `simulation/AgentSimulator.ts`                | injected asset service and references, timers |
| `simulation/SimulatedAgentMemoryModel.ts`     | none, pure                                    |
| `simulation/SimulatedConversationAgent.ts`    | timers, abort signal                          |
| `simulation/SimulatedConversationDecision.ts` | none, pure                                    |
| `simulation/SimulatedConversationObserver.ts` | none, pure                                    |
| `simulation/SimulatedPlanDecision.ts`         | none, pure                                    |
| `simulation/SimulatedPlanExecution.ts`        | injected real execution and simulator         |

## Not applicable

`runtime/README.md` is declarative documentation and has no executable
statements.

## Open work

- Complete behavior coverage for the catalog, runtime and simulation modules.
- The earlier coverage sections keep their own evidence; this inventory does not
  re-verify them.
- Unit tests will not prove integration, process or operating behavior of the
  catalog transport, the ACP tool bridge or the simulation inside a running
  instance.
