# Backend error classes

Inventory of `backend/error`, the sixth backend test area. The directory holds
44 modules. All of them contain runtime statements (error classes, message
tables, type guards and small helpers), so none is declaration-only and none is
marked not applicable.

## Modules and behavior to verify

| Kind                            | Modules                                                                                                                                                                                                                                                                                | Behavior                                                                                                                                                                                                                                                                            |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Coded agent errors              | `AgentErrors.ts`, `AgentPlanCallErrorMessages.ts`, `AcpCleanupUnconfirmedError.ts`, `AgentPlanReadDenied.ts`                                                                                                                                                                           | Every code of `AGENT_ERROR_MESSAGES` maps to a stable public message; `isAgentErrorCode` accepts only own keys; subclasses keep their name, code and payload; `withPlanReadOrigin` re-throws an unqualified `plan_access_denied` with its origin and passes everything else through |
| Agent and plan errors           | `Agent*Error.ts`, `AgentPlan*.ts`, `AgentExecutionErrors.ts`                                                                                                                                                                                                                           | Name, code, status and carried values of each class                                                                                                                                                                                                                                 |
| Domain errors                   | `AdministrationError.ts`, `AutomationError.ts`, `CalendarError.ts`, `ChatErrors.ts`, `ConversationError.ts`, `ConversationObserverError.ts`, `DecisionModelError.ts`, `DiscordErrors.ts`, `ProjectErrors.ts`, `RemoteErrors.ts`, `UserErrors.ts`, `WikiErrors.ts`, `WorkItemErrors.ts` | Constructors, defaults, discriminating helpers and the values handed to callers                                                                                                                                                                                                     |
| Authorization and device errors | `McpAuthorizationError.ts`, `McpDeviceError.ts`, `PicaAuthorizationError.ts`, `AgentAuthorizationError.ts`                                                                                                                                                                             | Fixed public message, status and `Retry-After` seconds                                                                                                                                                                                                                              |
| Log description                 | `ErrorDescription.ts`                                                                                                                                                                                                                                                                  | `describeError` leaves quoted parts out, truncates the first message line, appends the code unless it equals the message, and adds the path only for a failed system call                                                                                                           |

## External boundaries

The modules touch no network, filesystem, process or database. Tests need no
mocks and must not use live data.

## Measurement scope

The directory is not yet part of `BACKEND_COVERAGE_SECTIONS` in
`vitest.backend.config.ts`; the unit tests and the coverage section for it
follow with the test work of this area. The areas `agents`, `database` and
`service` of `backend/` are also still open. Unit tests of these modules do not
prove behavior at the external boundaries where the errors are translated, such
as HTTP responses or WebSocket messages.
