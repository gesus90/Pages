# Native OpenCode ACP for Pica (PAGE-91)

Observed on 2026-10-16 with the installed OpenCode **1.18.34**. All local
protocol inspection used empty temporary homes, no credentials and **no
`session/prompt` or model invocation**. The browser functional check belongs to
Mokona. This is a capability record, not an automated test or harness.

| Capability              | Observed contract                                                                                                          | Pages handling                                                                                                                                                     |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Entry point             | `opencode acp`; native agent info `OpenCode`, `1.18.34`, protocol 1                                                        | Existing `AcpSession`, exact verified version; no external adapter. Internal HTTP server uses loopback, port 0 and a fresh process password.                       |
| Steering                | No `_meta.steering` announcement; `_session/steering` returns `-32601 Method not found`                                    | No steering request and no concurrent prompt. Visible `followUp` with its own turn; the UI explicitly says steering is unavailable.                                |
| Session configuration   | `session/new` returns select options `model` and `mode`; mode `pages-pica` was selected and confirmed without a model call | Exact full provider/model ID and the managed mode must be offered and confirmed before a prompt.                                                                   |
| Variant                 | Release source exposes `effort` for models with variants; `default` resets it                                              | Exact stored variant; null explicitly resets to `default` when the selector exists. Not observed with a credentialed model.                                        |
| Content                 | Handshake advertises `embeddedContext` and `image`                                                                         | Shared Pica upload/type checks, immutable message payloads and visible transfer snapshots. Individual models may reject images.                                    |
| MCP                     | Handshake advertises HTTP and SSE                                                                                          | Only the existing `pages` HTTP bridge is supplied; job token goes over ACP stdin. Existing executor reauthorizes every call.                                       |
| MCP readiness           | Release source ignores registration failures; no verified local MCP-status command                                         | No fabricated readiness confirmation. The browser check must verify an actual authorized Pages tool call.                                                          |
| Native tools            | Managed permission rules deny `*` and allow only `pages_*`; custom Pica agent has the same rules                           | No native shell, filesystem, web, delegation or admin tool; unexpected ACP permission requests are refused. Tool execution remains subject to Pages authorization. |
| Resume / close          | Handshake advertises both; new → mode selection → close → resume → close succeeded locally without a prompt                | Existing owner/chat/connection/model/variant/profile mapping and resource lifecycle. Closing a protocol session keeps its native archive.                          |
| Background continuation | Pica uses existing server-owned jobs and journals                                                                          | Browser close does not cancel. Explicit stop, deadlines and server shutdown cancel through the existing registry. No replay after restart.                         |
| Context                 | Release source reports `usage_update.used` and `.size`                                                                     | Adapter reports only; unknown values remain unavailable.                                                                                                           |
| Tokens                  | Release source constructs prompt usage from the final assistant model step; cache and reasoning can contribute to total    | Persisted as partial counts, never presented as a complete tool-loop total.                                                                                        |
| Cost                    | Release source sums assistant costs over the native session                                                                | Estimated session total; never a billed amount or a sum of repeated usage reports.                                                                                 |
| Deletion                | Protocol close does not delete the native archive                                                                          | Pages deletion reports its own scope; no claim that native/provider archives were erased.                                                                          |

The source audit uses the exact release, rather than the moving development
branch:

- [ACP service](https://github.com/anomalyco/opencode/blob/v1.18.34/packages/opencode/src/acp/service.ts): initialization, session configuration, resume, close and MCP registration.
- [Configuration selectors](https://github.com/anomalyco/opencode/blob/v1.18.34/packages/opencode/src/acp/config-option.ts): full model IDs, variants and the explicit default.
- [Usage](https://github.com/anomalyco/opencode/blob/v1.18.34/packages/opencode/src/acp/usage.ts): last-step token report and cumulative session cost.
- [Content conversion](https://github.com/anomalyco/opencode/blob/v1.18.34/packages/opencode/src/acp/content.ts): inline text resources and image blocks.
- [Configuration loading](https://github.com/anomalyco/opencode/blob/v1.18.34/packages/opencode/src/config/config.ts) and [configuration paths](https://github.com/anomalyco/opencode/blob/v1.18.34/packages/opencode/src/config/paths.ts): sources that must stay isolated or block startup.

Functional behavior with a real model, tool calls, image understanding,
compaction and cancellation has deliberately not been exercised by Codex.
