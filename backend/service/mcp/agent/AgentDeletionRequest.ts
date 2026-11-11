import { z } from "zod";

import { AgentDeletionError } from "@/backend/service/employee/AgentDeletionService";

const DELETE_SCHEMA = z
  .object({
    previewId: z.string().uuid(),
    operationId: z.string().uuid(),
  })
  .strict();

const RESTORE_SCHEMA = z.object({ operationId: z.string().uuid() }).strict();

const LIST_SCHEMA = z
  .object({
    cursor: z.string().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
  })
  .strict();

/** Validated inputs of the agent deletion resources. */
export class AgentDeletionRequest {
  /** Reads the preview identifier and idempotency key of a deletion. */
  public static delete(input: unknown): z.infer<typeof DELETE_SCHEMA> {
    const result = DELETE_SCHEMA.safeParse(input);
    if (result.success) return result.data;
    const reason =
      typeof input === "object" &&
      input !== null &&
      !Reflect.has(input, "previewId")
        ? "preview_missing"
        : "invalid_body";
    throw new AgentDeletionError("INVALID_REQUEST", reason);
  }

  /** Reads the idempotency key of a restoration. */
  public static restore(input: unknown): z.infer<typeof RESTORE_SCHEMA> {
    const result = RESTORE_SCHEMA.safeParse(input);
    if (result.success) return result.data;
    throw new AgentDeletionError("INVALID_REQUEST", "invalid_body");
  }

  /** Reads the cursor and bounded page size of the deleted-agent list. */
  public static list(input: URLSearchParams): {
    readonly cursor: string | null;
    readonly limit: number;
  } {
    const result = LIST_SCHEMA.safeParse(Object.fromEntries(input));
    if (!result.success)
      throw new AgentDeletionError("INVALID_REQUEST", "invalid_query");
    return {
      cursor: result.data.cursor ?? null,
      limit: result.data.limit ?? 50,
    };
  }
}
