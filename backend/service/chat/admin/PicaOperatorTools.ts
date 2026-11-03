import { readParameterRecord } from "@/backend/service/agents/AgentParameterReader";

import { PICA_TOOL_OUTCOME } from "../PicaToolSchemas";
import { nativeToolInputSchema } from "../PicaToolContracts";
import { picaOperatorEntries } from "./PicaOperatorCatalog";

import type { RuntimeExecutionContext } from "@/backend/agents/runtime/RuntimeExecutionContext";
import type { RuntimeToolRegistry } from "@/backend/agents/runtime/RuntimeToolRegistry";
import type { PicaToolOutcome } from "../PicaToolSchemas";
import type { PicaOperatorEntry } from "./PicaOperatorCatalog";

/** How the administrator tools reach the operation catalog. */
export interface PicaOperatorDispatch {
  /** The operations that already have a native tool for every person. */
  readonly native: ReadonlySet<string>;
  readonly run: (
    entry: PicaOperatorEntry,
    parameters: Readonly<Record<string, unknown>>,
    context: RuntimeExecutionContext,
  ) => Promise<PicaToolOutcome>;
}

const OPERATOR_NOTE =
  "ADMIN ONLY: Pages checks the current administrator rights on every call, supplies operationId and the confirmation itself, and never accepts them from you.";

function describeOperator(entry: PicaOperatorEntry): string {
  const description = entry.tool.description ?? entry.tool.name;
  return description.startsWith("ADMIN ONLY")
    ? description
    : `${OPERATOR_NOTE} ${description}`;
}

/**
 * Registers the administrator catalog on the registry every person's tools share.
 *
 * @param registry - The registry of the turn.
 * @param dispatch - Runs one operation with fresh rights.
 *
 * @remarks
 * The tools carry the `administrator` access class, so the registry lists
 * and runs them only for a current administrator. A write that failed is not
 * sent again unchanged in the same turn.
 */
export function registerPicaOperatorTools(
  registry: RuntimeToolRegistry,
  dispatch: PicaOperatorDispatch,
): void {
  const failedWrites = new Set<string>();
  for (const entry of picaOperatorEntries(dispatch.native)) {
    registry.register<unknown, PicaToolOutcome>({
      id: entry.tool.name,
      access: "administrator",
      description: describeOperator(entry),
      inputSchema: nativeToolInputSchema(entry.tool),
      outputSchema: PICA_TOOL_OUTCOME,
      execute: async (input, context) => {
        const parameters = readParameterRecord(input);
        const attempt = JSON.stringify([entry.operation, parameters]);
        if (entry.isWrite && failedWrites.has(attempt))
          return { ok: false, result: null, error: "RETRY_REFUSED" };
        const outcome = await dispatch.run(entry, parameters, context);
        if (entry.isWrite && !outcome.ok && outcome.error !== "STEP_LIMIT")
          failedWrites.add(attempt);
        return outcome;
      },
    });
  }
}
