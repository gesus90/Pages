import { RuntimeToolRegistry } from "@/backend/agents/runtime/RuntimeToolRegistry";
import { redactAssistantCredentials } from "@/backend/service/assistant/TextAssistantValidation";

import { CHAT_MAXIMUM_ACTIONS } from "./ChatService";
import { PICA_TOOL_OUTCOME, PICA_TOOL_SCHEMAS } from "./PicaToolSchemas";
import { PicaWriteConfirmation } from "./PicaWriteConfirmation";

import type { RuntimeExecutionContext } from "@/backend/agents/runtime/RuntimeExecutionContext";
import type { ChatToolExecutor } from "./ChatToolExecutor";
import type { PicaToolOutcome } from "./PicaToolSchemas";

/** Services and current input captured by the server for one native tool catalog. */
export interface PicaToolsInput {
  readonly tools: Pick<ChatToolExecutor, "run">;
  readonly message: string;
  readonly authorize: () => Promise<void>;
  /** Write confirmations of the turn; a steer adds its lines to them. Defaults to the message's own. */
  readonly confirmations?: PicaWriteConfirmation;
}

/** Creates five native tools with fixed service dispatch, fresh rights and exact write confirmations. */
export function createPicaTools(input: PicaToolsInput): RuntimeToolRegistry {
  const registry = new RuntimeToolRegistry();
  const confirmations =
    input.confirmations ?? new PicaWriteConfirmation(input.message);
  let calls = 0;
  const execute = async (
    operation: string,
    parameters: Readonly<Record<string, unknown>>,
    context: RuntimeExecutionContext,
  ): Promise<PicaToolOutcome> => {
    await input.authorize();
    context.signal.throwIfAborted();
    if (calls >= CHAT_MAXIMUM_ACTIONS)
      return { ok: false, result: null, error: "STEP_LIMIT" };
    calls += 1;
    const outcome = await input.tools.run(
      context.userId,
      { operation, parameters },
      null,
    );
    context.signal.throwIfAborted();
    if (!outcome.ok)
      return { ok: false, result: null, error: outcome.error ?? "FAILED" };
    const result = redactAssistantCredentials(
      JSON.stringify(outcome.result ?? null),
    );
    if (result.length > 20_000)
      return { ok: false, result: null, error: "RESULT_TOO_LARGE" };
    return { ok: true, result, error: null };
  };
  registry.register({
    id: "tickets_search",
    description:
      "Search visible tickets of a known project by key, title or description; returns at most 20 tickets and a paging cursor.",
    inputSchema: PICA_TOOL_SCHEMAS.tickets_search,
    outputSchema: PICA_TOOL_OUTCOME,
    execute: (parameters, context) =>
      execute(
        "tickets.search",
        { ...parameters, limit: parameters.limit ?? 20 },
        context,
      ),
  });
  registry.register({
    id: "tickets_read",
    description:
      "Read a visible ticket by ID or key, including the current title and status ID before proposing a change.",
    inputSchema: PICA_TOOL_SCHEMAS.tickets_read,
    outputSchema: PICA_TOOL_OUTCOME,
    execute: (parameters, context) =>
      execute("ticket.read", parameters, context),
  });
  registry.register({
    id: "projects_read",
    description: "Read the core fields of a visible project by ID.",
    inputSchema: PICA_TOOL_SCHEMAS.projects_read,
    outputSchema: PICA_TOOL_OUTCOME,
    execute: (parameters, context) =>
      execute("projects.read", parameters, context),
  });
  registry.register({
    id: "tickets_set_title",
    description:
      "Change only a ticket title with its expected old title. Requires an exact BESTÄTIGEN/CONFIRM line in the current human message. Never retry a write automatically.",
    inputSchema: PICA_TOOL_SCHEMAS.tickets_set_title,
    outputSchema: PICA_TOOL_OUTCOME,
    execute: async (parameters, context) =>
      confirmations.consume("tickets_set_title", parameters)
        ? execute("ticket.setTitle", parameters, context)
        : { ok: false, result: null, error: "CONFIRMATION_REQUIRED" },
  });
  registry.register({
    id: "tickets_set_status",
    description:
      "Change only a ticket status with its expected old status ID. Requires an exact BESTÄTIGEN/CONFIRM line in the current human message. Never retry a write automatically.",
    inputSchema: PICA_TOOL_SCHEMAS.tickets_set_status,
    outputSchema: PICA_TOOL_OUTCOME,
    execute: async (parameters, context) =>
      confirmations.consume("tickets_set_status", parameters)
        ? execute("ticket.setStatus", parameters, context)
        : { ok: false, result: null, error: "CONFIRMATION_REQUIRED" },
  });
  return registry;
}
