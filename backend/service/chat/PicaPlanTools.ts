import { z } from "zod";

import { PLAN_READ_TOOLS, PLAN_WRITE_TOOLS } from "@/mcp/src/tools/plans";
import {
  PLAN_RESOURCE_READ_TOOLS,
  PLAN_RESOURCE_WRITE_TOOLS,
} from "@/mcp/src/tools/plan-resources";
import { readParameterRecord } from "@/backend/service/agents/AgentParameterReader";

import { PICA_TOOL_OUTCOME } from "./PicaToolSchemas";

import type { RuntimeToolRegistry } from "@/backend/agents/runtime/RuntimeToolRegistry";
import type { RuntimeExecutionContext } from "@/backend/agents/runtime/RuntimeExecutionContext";
import type { ChatOperation } from "./ChatToolCatalog";
import type { PicaToolOutcome } from "./PicaToolSchemas";

function isPlanToolSchema(
  input: unknown,
): input is Parameters<typeof z.fromJSONSchema>[0] {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}

interface PlanToolDispatch {
  readonly execute: (
    operation: ChatOperation,
    parameters: Readonly<Record<string, unknown>>,
    context: RuntimeExecutionContext,
  ) => Promise<PicaToolOutcome>;
}

/** Registers native backend handlers from the shared static plan catalog; no MCP client or transport is started. */
export function registerPicaPlanTools(
  registry: RuntimeToolRegistry,
  dispatch: PlanToolDispatch,
): void {
  const failedWrites = new Set<string>();
  const reads = [...PLAN_READ_TOOLS, ...PLAN_RESOURCE_READ_TOOLS];
  const writes = [...PLAN_WRITE_TOOLS, ...PLAN_RESOURCE_WRITE_TOOLS];
  for (const { operation, tool } of [...reads, ...writes]) {
    const properties = Object.fromEntries(
      Object.entries(tool.inputSchema.properties ?? {}).filter(
        ([key]) => key !== "operationId" && key !== "confirmation",
      ),
    );
    const required = (tool.inputSchema.required ?? []).filter(
      (key) => key !== "operationId" && key !== "confirmation",
    );
    const nativeSchema: Record<string, Parameters<typeof z.fromJSONSchema>[0]> =
      {};
    for (const [key, entry] of Object.entries(properties)) {
      if (!isPlanToolSchema(entry))
        throw new Error("Invalid static plan tool schema");
      nativeSchema[key] = entry;
    }
    const schema = z.fromJSONSchema({
      ...tool.inputSchema,
      properties: nativeSchema,
      required,
    });
    const isWrite = writes.some((entry) => entry.operation === operation);
    registry.register({
      id: tool.name,
      description: `${tool.description ?? tool.name} Pages supplies operationId and deletion confirmation. Edits never start a run; only explicit Play or Resume does.`,
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
