import {
  PLAN_READ_TOOLS,
  PLAN_WRITE_TOOLS,
} from "@/definition/AgentTools/Plans";
import {
  PLAN_RESOURCE_READ_TOOLS,
  PLAN_RESOURCE_WRITE_TOOLS,
} from "@/definition/AgentTools/PlanResources";
import { readParameterRecord } from "@/backend/service/agents/AgentParameterReader";

import { PICA_TOOL_OUTCOME } from "./PicaToolSchemas";
import { nativeToolInputSchema } from "./PicaToolContracts";

import type { RuntimeToolRegistry } from "@/backend/agents/runtime/RuntimeToolRegistry";
import type { RuntimeExecutionContext } from "@/backend/agents/runtime/RuntimeExecutionContext";
import type { ChatOperation } from "./ChatToolCatalog";
import type { PicaToolOutcome } from "./PicaToolSchemas";

interface PlanToolDispatch {
  readonly execute: (
    operation: ChatOperation,
    parameters: Readonly<Record<string, unknown>>,
    context: RuntimeExecutionContext,
  ) => Promise<PicaToolOutcome>;
}

/** Registers native backend handlers from the shared static plan catalog. */
export function registerPicaPlanTools(
  registry: RuntimeToolRegistry,
  dispatch: PlanToolDispatch,
): void {
  const failedWrites = new Set<string>();
  const reads = [...PLAN_READ_TOOLS, ...PLAN_RESOURCE_READ_TOOLS];
  const writes = [...PLAN_WRITE_TOOLS, ...PLAN_RESOURCE_WRITE_TOOLS];
  for (const { operation, tool } of [...reads, ...writes]) {
    const schema = nativeToolInputSchema(tool);
    const isWrite = writes.some((entry) => entry.operation === operation);
    registry.register({
      id: tool.name,
      description: `${tool.description ?? tool.name} Pages supplies a stable operationId. For plan and template deletion Pages binds the existing confirmation word to this exact plan and revision or template and requires the person's reply in a later message; never fabricate it. Edits never start a run; only an explicit separate user request for Play or Resume does.`,
      inputSchema: schema,
      outputSchema: PICA_TOOL_OUTCOME,
      execute: async (input, context) => {
        const parameters = readParameterRecord(input);
        const attempt = JSON.stringify([operation, parameters]);
        if (isWrite && failedWrites.has(attempt))
          return { ok: false, result: null, error: "RETRY_REFUSED" };
        const outcome = await dispatch.execute(operation, parameters, context);
        if (isWrite && !outcome.ok && outcome.error !== "STEP_LIMIT")
          failedWrites.add(attempt);
        return outcome;
      },
    });
  }
}
