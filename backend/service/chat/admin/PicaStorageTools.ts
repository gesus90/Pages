import { readParameterRecord } from "@/backend/service/agents/AgentParameterReader";

import { PICA_TOOL_OUTCOME } from "../PicaToolSchemas";
import {
  PICA_STORAGE_DESCRIPTIONS,
  PICA_STORAGE_HINTS,
  PICA_STORAGE_READ_TOOLS,
  PICA_STORAGE_SCHEMAS,
} from "./PicaStorageContracts";

import type { RuntimeExecutionContext } from "@/backend/agents/runtime/RuntimeExecutionContext";
import type { RuntimeToolRegistry } from "@/backend/agents/runtime/RuntimeToolRegistry";
import type { PicaPlanTurn } from "../PicaPlanConfirmation";
import type { PicaToolOutcome } from "../PicaToolSchemas";
import type { PicaAdminService } from "./PicaAdminService";
import type { PicaStorageTool } from "./PicaStorageContracts";

/** What the Storage tools of one turn are registered with. */
export interface PicaStorageToolParts {
  readonly service: Pick<PicaAdminService, "runStorage">;
  /** The raw human message and server-owned legacy confirmation context. */
  readonly turn: (context: RuntimeExecutionContext) => Promise<PicaPlanTurn>;
  /** Spends one call of the turn budget; `false` when it is used up. */
  readonly spend: () => boolean;
}

const STORAGE_NOTE =
  "Pages checks current folder grants for the acting account and what the connected Google account allows; Pica has no rights of its own. Use it only on the person's explicit request. No tokens or secret links are ever returned.";

function isStorageTool(name: string): name is PicaStorageTool {
  return Object.hasOwn(PICA_STORAGE_SCHEMAS, name);
}

/** Explains a refused administrator right in the result the model reads. */
function explained(outcome: PicaToolOutcome): PicaToolOutcome {
  return outcome.error === "ADMIN_REQUIRED"
    ? {
        ...outcome,
        result: JSON.stringify({ hint: PICA_STORAGE_HINTS.forbidden }),
      }
    : outcome;
}

/**
 * Registers the native Storage tools (PAGE-271).
 *
 * @param registry - The registry of the turn.
 * @param parts - The privileged dispatch, the human turn and the budget.
 *
 * @remarks
 * All tools use the acting account and check folder grants in the service. A change that failed is not sent
 * again unchanged in the same turn; a requested confirmation is no failure,
 * because the identical call follows the person's reply.
 */
export function registerPicaStorageTools(
  registry: RuntimeToolRegistry,
  parts: PicaStorageToolParts,
): void {
  const failedWrites = new Set<string>();
  for (const tool of Object.keys(PICA_STORAGE_SCHEMAS).filter(isStorageTool)) {
    const isWrite = !PICA_STORAGE_READ_TOOLS.has(tool);
    registry.register<unknown, PicaToolOutcome>({
      id: tool,
      access: "user",
      description: `${PICA_STORAGE_DESCRIPTIONS[tool]} ${STORAGE_NOTE}`,
      inputSchema: PICA_STORAGE_SCHEMAS[tool],
      outputSchema: PICA_TOOL_OUTCOME,
      execute: async (input, context) => {
        const parameters = readParameterRecord(input);
        const attempt = JSON.stringify([tool, parameters]);
        if (isWrite && failedWrites.has(attempt))
          return { ok: false, result: null, error: "RETRY_REFUSED" };
        if (!parts.spend())
          return { ok: false, result: null, error: "STEP_LIMIT" };
        const outcome = explained(
          await parts.service.runStorage({
            tool,
            parameters,
            context,
            turn: await parts.turn(context),
          }),
        );
        if (isWrite && !outcome.ok && outcome.error !== "CONFIRMATION_REQUIRED")
          failedWrites.add(attempt);
        return outcome;
      },
    });
  }
}
