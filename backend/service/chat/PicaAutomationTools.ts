import {
  AUTOMATION_READ_TOOLS,
  AUTOMATION_WRITE_TOOLS,
} from "@/definition/AgentTools/Automations";
import { readParameterRecord } from "@/backend/service/agents/AgentParameterReader";

import { PICA_TOOL_OUTCOME } from "./PicaToolSchemas";
import { nativeToolInputSchema } from "./PicaToolContracts";

import type { RuntimeToolRegistry } from "@/backend/agents/runtime/RuntimeToolRegistry";
import type { RuntimeExecutionContext } from "@/backend/agents/runtime/RuntimeExecutionContext";
import type { ChatOperation } from "./ChatToolCatalog";
import type { PicaToolOutcome } from "./PicaToolSchemas";

interface AutomationToolDispatch {
  readonly execute: (
    operation: ChatOperation,
    parameters: Readonly<Record<string, unknown>>,
    context: RuntimeExecutionContext,
  ) => Promise<PicaToolOutcome>;
}

const NOTE =
  "Pages runs the call as the account of this conversation, or as the agent's own account in an agent's session, with its current rights; it supplies the operationId itself. Delete only on the person's explicit request in the current message. A read-only agent may only list and read.";

/**
 * Registers the automation tools of the shared static catalog (PAGE-297) in
 * Pica's registry, which agent employees receive through their bridge too.
 *
 * @param registry - The tool registry of one turn.
 * @param dispatch - Runs an operation through the chat's operation catalog.
 */
export function registerPicaAutomationTools(
  registry: RuntimeToolRegistry,
  dispatch: AutomationToolDispatch,
): void {
  for (const { operation, tool } of [
    ...AUTOMATION_READ_TOOLS,
    ...AUTOMATION_WRITE_TOOLS,
  ])
    registry.register({
      id: tool.name,
      description: `${tool.description ?? tool.name} ${NOTE}`,
      inputSchema: nativeToolInputSchema(tool),
      outputSchema: PICA_TOOL_OUTCOME,
      execute: async (input, context) =>
        dispatch.execute(operation, readParameterRecord(input), context),
    });
}
