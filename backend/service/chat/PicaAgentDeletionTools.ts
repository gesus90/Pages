import { z } from "zod";

import { AgentDeletionError } from "@/backend/service/employee/AgentDeletionService";

import { PICA_TOOL_OUTCOME } from "./PicaToolSchemas";

import type { RuntimeToolRegistry } from "@/backend/agents/runtime/RuntimeToolRegistry";
import type { AgentDeletionService } from "@/backend/service/employee/AgentDeletionService";
import type { PicaToolOutcome } from "./PicaToolSchemas";

const AGENT_SCHEMA = z.object({ agentId: z.string().uuid() }).strict();
const DELETE_SCHEMA = AGENT_SCHEMA.extend({
  previewId: z.string().uuid(),
  operationId: z.string().uuid(),
});
const RESTORE_SCHEMA = AGENT_SCHEMA.extend({ operationId: z.string().uuid() });
const LIST_SCHEMA = z
  .object({
    cursor: z.string().nullable().optional(),
    limit: z.number().int().min(1).max(100).optional(),
  })
  .strict();

function answer(result: unknown): PicaToolOutcome {
  return { ok: true, result: JSON.stringify(result), error: null };
}

async function invoke(work: () => Promise<unknown>): Promise<PicaToolOutcome> {
  try {
    return answer(await work());
  } catch (error: unknown) {
    if (error instanceof AgentDeletionError)
      return {
        ok: false,
        result: null,
        error: `${error.code}:${error.reason}`,
      };
    throw error;
  }
}

/** Registers the four Pages agent deletion operations on the pages-pica bridge. */
export function registerPicaAgentDeletionTools(
  registry: RuntimeToolRegistry,
  service: AgentDeletionService,
  spend: () => boolean,
): void {
  registry.register<z.infer<typeof AGENT_SCHEMA>, PicaToolOutcome>({
    id: "agents_delete_preview",
    description:
      "Show what deleting this AI agent would remove or retain, including active plan runs. Use on the person's request to delete an agent.",
    inputSchema: AGENT_SCHEMA,
    outputSchema: PICA_TOOL_OUTCOME,
    execute: async ({ agentId }, context) => {
      await context.authorize();
      if (!spend()) return { ok: false, result: null, error: "STEP_LIMIT" };
      return invoke(() => service.preview(context.userId, agentId));
    },
  });
  registry.register<z.infer<typeof DELETE_SCHEMA>, PicaToolOutcome>({
    id: "agents_delete",
    description:
      "Delete this AI agent only after the person explicitly asks for it and after showing the current preview. Supply its previewId. No confirmation word is needed.",
    inputSchema: DELETE_SCHEMA,
    outputSchema: PICA_TOOL_OUTCOME,
    execute: async ({ agentId, previewId, operationId }, context) => {
      await context.authorize();
      if (!spend()) return { ok: false, result: null, error: "STEP_LIMIT" };
      return invoke(() =>
        service.delete(context.userId, agentId, previewId, operationId),
      );
    },
  });
  registry.register<z.infer<typeof RESTORE_SCHEMA>, PicaToolOutcome>({
    id: "agents_restore",
    description:
      "Administrator only: restore a deleted AI agent within seven days on the person's request.",
    inputSchema: RESTORE_SCHEMA,
    outputSchema: PICA_TOOL_OUTCOME,
    execute: async ({ agentId, operationId }, context) => {
      await context.authorize();
      if (!spend()) return { ok: false, result: null, error: "STEP_LIMIT" };
      return invoke(() =>
        service.restore(context.userId, agentId, operationId),
      );
    },
  });
  registry.register<z.infer<typeof LIST_SCHEMA>, PicaToolOutcome>({
    id: "agents_deleted_list",
    description:
      "Administrator only: list AI agents that can still be restored.",
    inputSchema: LIST_SCHEMA,
    outputSchema: PICA_TOOL_OUTCOME,
    execute: async ({ cursor, limit }, context) => {
      await context.authorize();
      if (!spend()) return { ok: false, result: null, error: "STEP_LIMIT" };
      return invoke(() =>
        service.deleted(context.userId, cursor ?? null, limit ?? 50),
      );
    },
  });
}
