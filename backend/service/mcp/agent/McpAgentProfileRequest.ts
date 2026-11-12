import { z } from "zod";

import { AgentProfileError } from "@/backend/error/AgentProfileError";
import { AGENT_PROFILE_LIMITS } from "@/definition/AgentProfileRead";

import type { AgentProfileQuery } from "@/definition/AgentProfileRead";

const MAXIMUM_IDENTIFIER_LENGTH = 100;
/** A cursor is the position of the next page in the list. */
const CURSOR_PATTERN = /^\d{1,9}$/u;
/** The whole number of a limit as the query writes it. */
const LIMIT_PATTERN = /^-?\d{1,6}$/u;

const identifierField = z.string().trim().min(1).max(MAXIMUM_IDENTIFIER_LENGTH);

const querySchema = z
  .object({
    groupId: identifierField.optional(),
    departmentId: identifierField.optional(),
    projectId: identifierField.optional(),
    cursor: z.string().regex(CURSOR_PATTERN).optional(),
    limit: z.string().regex(LIMIT_PATTERN).optional(),
  })
  .strict();

/** Names the first refused parameter of a query for `reason`. */
function refusedParameter(error: z.ZodError): string {
  const [issue] = error.issues;
  if (issue?.code === "unrecognized_keys") return issue.keys[0] ?? "query";
  return String(issue?.path[0] ?? "query");
}

/** Validates the query of `GET /agents` and the identifiers of the three profile routes. */
export class McpAgentProfileRequest {
  /**
   * Reads the filters and the page of `agents_list`.
   *
   * @param query - The query string of the request.
   * @returns The validated query.
   * @throws {AgentProfileError} `invalid_request` with the refused parameter as `reason`;
   * a `limit` outside 1 to 100 is refused, never clamped.
   */
  public static list(query: URLSearchParams): AgentProfileQuery {
    const entries: Record<string, string> = {};
    for (const [name, value] of query) {
      if (Object.hasOwn(entries, name))
        throw new AgentProfileError("invalid_request", name);
      entries[name] = value;
    }
    const parsed = querySchema.safeParse(entries);
    if (!parsed.success)
      throw new AgentProfileError(
        "invalid_request",
        refusedParameter(parsed.error),
      );
    const { limit, ...rest } = parsed.data;
    if (limit === undefined) return rest;
    const size = Number(limit);
    if (size < 1 || size > AGENT_PROFILE_LIMITS.maximumLimit)
      throw new AgentProfileError("invalid_request", "limit");
    return { ...rest, limit: size };
  }

  /**
   * Reads the identifier of a path.
   *
   * @param value - The path parameter.
   * @param name - Which parameter it is, for `reason`.
   * @throws {AgentProfileError} `invalid_request` for an empty or overlong identifier.
   */
  public static identifier(value: string | undefined, name: string): string {
    const parsed = identifierField.safeParse(value);
    if (!parsed.success) throw new AgentProfileError("invalid_request", name);
    return parsed.data;
  }
}
