# Pages execution context and native tools

`RuntimeExecutionContext` binds a verified person, chat session, run and abort
signal. Its frozen identity is built by the server; model arguments cannot
replace it. Authorization checks session ownership and cancellation again
before each operation.

`RuntimeToolRegistry` registers Zod input and output contracts. `describe`
exports the tool names and JSON input schemas to the ACP/MCP bridge. `invoke`
validates untrusted arguments, reauthorizes the context, invokes the existing
Pages handler and validates its result. Unknown tools and malformed arguments
never dispatch a service.

Pica uses Codex CLI, Claude Code or opencode through the existing ACP job,
scheduler, session and tool infrastructure. Pages retains transcripts,
attachments, settings, confirmation words, execution budgets and cancellation.
There is no direct API execution in Pica and no alternate model fallback.

Own HTTP adapters remain for API connection checks, catalogs and existing
direct API plan nodes. They do not own Pica's model/tool loop.
