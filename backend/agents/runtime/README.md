# Shared agent runtime

This module provides invocation-scoped Mastra agents, used by Pica's API mode
(PAGE-83 partial). It does not replace the Pages DAG or start another application server.
`@mastra/core` is pinned to **1.74.0**, the newest stable release allowed by the
repository's ten-day package release policy on 16 October 2026. Node and Zod use
the existing Pages versions. No Mastra storage provider or database is installed.

## Server composition

1. Resolve the authenticated `User`, owned chat session, run ID and `AbortSignal`
   on the server. `createRuntimeExecutionContext` verifies the session and freezes
   the identity snapshot. Its `authorize` callback rechecks session access before
   model, tool and memory calls. Existing services still enforce current rights.
2. Register native handlers with `RuntimeToolRegistry.register`, including Zod
   input/output schemas. Registration binds schemas and dispatch only; business
   logic belongs to existing services. Each `bind` creates separate closures for
   the invocation. Tool arguments and mutable Mastra request metadata cannot
   replace the captured user, session or run. Handler cancellation combines the
   Pages signal and the tool execution signal.
3. Pass an explicitly resolved SDK model object to `createRuntimeAgent`. Supported
   model specs are v2, v3 and v4; global provider strings, automatic environment
   credential selection and internal Mastra streaming wrappers are excluded.
   The factory returns a real `Agent` with `generate` and `stream`, a five-step
   default budget, zero model retries and the bound run/context/signal defaults.
   The agent uses Mastra's no-op logger so provider errors cannot log prompts or
   credentials; callers translate failures at their existing error boundary.
   Call options are a trusted server API; never forward client execution options.
   Consume `textStream` for text or `fullStream` for tool and approval events.
4. `createRuntimeMemory` exposes explicit `history` and `append` operations over
   `ChatContextService` and `ChatSessionRepository`. It preserves the existing
   summary boundary. The caller controls transcript persistence and applies the
   existing prompt size/redaction rules. Mastra does not save another transcript.
5. `RuntimeApproval` delegates to `ChatToolExecutor`, using confirmation words
   supplied by the server from the current human message. Confirmation operations
   consume the words once, including parallel calls. Human-only temporary password
   receipts go to a required callback, outside tool output. Mark tools with
   `requireApproval` when an additional Mastra suspension is desired; Mastra
   approval alone cannot provide a Pages confirmation word.

Create a new context, agent and approval adapter for each invocation. Reusing the
tool registry across invocations is supported; reusing a bound agent across users
or human messages is not. The runtime adds no UI, request route or client DTO.

## ACP boundary

`runRuntimeAcpTurn` uses the **existing shared, recovered** `AcpResourceScheduler`.
The scheduler owns FIFO admission, durable starting leases, process capacity,
shutdown and cleanup uncertainty. The adapter reauthorizes after admission,
passes the scheduler's combined signal and generated instance ID to an injected
native starter, awaits one `PlanSession.turn`, and closes the scheduled session
in `finally`. Unconfirmed cleanup fails the call and leaves the lease occupied.
API models do not reference this scheduler and consume no ACP slots.

The starter is an **unscheduled server boundary**. It must enforce connection
authorization, exact model/effort, credential handling, workspace isolation and
confirmed process cleanup using the existing Pages ACP machinery. In particular,
`CliSessionExecution.open` already schedules ACP work: do not inject it beneath
another scheduler admission. Pica's production Codex path (PAGE-68,
`backend/service/chat/acp/`) therefore does not use this adapter: it opens its
session through the existing `PlanExecution.open` (one scheduler admission,
credential isolation, closeout) and reaches the native Pica tools through
`RuntimeToolRegistry.invoke`, the same registry the Mastra agent binds.

`createRuntimeAcpModel` adapts that turn to a supported SDK v2 model object. Both
Mastra `generate` and `stream` are supported, with a **buffered final answer**;
the adapter does not claim incremental native tokens or invent token usage.
Prompts become JSON with explicit message roles. The native starter selects and
checks the actual configured model; `modelId` identifies it to Mastra. Mastra
tools, tool messages, nontext content and JSON output are rejected before ACP
admission. Native ACP tools remain inside the native agent. A model that needs
native Mastra tool calling must use a compatible API model; an API-led agent can
also register `runRuntimeAcpTurn` as a delegation handler. No native tools are
silently converted into Mastra tools.

Mastra's separate `@mastra/acp` package can wrap external ACP agents as tools or
subagents. It starts its own child processes and does not automatically preserve
Pages admission, credential isolation or permission profiles. It is deliberately
not installed here. Mastra Code's ACP server implements the opposite direction.

## Deliberate limits

No workflow, durable agent, plan engine, DAG migration, snapshot storage,
automatic memory compaction, semantic recall or background worker is added.
`requireApproval` can suspend the native Mastra loop; durable approval recovery
needs storage and a Pages-owned authorization/resume design. That integration,
Pica's partial API composition now supplies its native tools (reads of
projects, tickets and the wiki, confirmed ticket and comment writes), fixed-host
SDK providers and its existing Pages prompt/history/attachment context. Over
Codex ACP the same tools reach the agent through Pages' MCP bridge (PAGE-68).
The remaining catalog, Mastra Memory and durable deletion approvals stay open.
The ACP text adapter does not translate SDK sampling/token settings to native
CLI options; native configuration remains the starter's responsibility.

## Validation and references

Unit tests under `tests/backend/backend/agents/runtime/` run real Mastra code
against fake SDK models and fake native sessions. Database, memory measurement,
process cleanup and provider boundaries are mocked. No provider login, API key,
network, real ACP process or MCP transport is required.

Current official documentation checked against installed 1.74.0 declarations and
actual `generate`/`stream` unit behavior:

- [Agents](https://mastra.ai/docs/agents/overview) and
  [Agent reference](https://mastra.ai/reference/agents/agent)
- [Tools and schemas](https://mastra.ai/docs/agents/tools) and
  [createTool](https://mastra.ai/reference/tools/create-tool)
- [Streaming](https://mastra.ai/docs/guides/streaming)
- [Memory](https://mastra.ai/docs/memory/overview)
- [Approval and suspend](https://mastra.ai/docs/agents/human-in-the-loop)
- [ACP connections](https://mastra.ai/docs/connections/acp) and
  [ACP server](https://mastra.ai/reference/code-sdk/acp-server)

The run's analysis, version evidence, decisions and full validation results are
under `/home/igor/Results/mastra-core-codex-20261016-0237/`.
