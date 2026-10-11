import type { AgentOperationDetails } from "@/definition/PagesAgentOperations";
import type { PagesAgentApiErrorCode } from "@/definition/PagesAgentApi";

/** Sends fixed credential-safe agent API failures. */
export function agentApiFailure(
  code: PagesAgentApiErrorCode,
  status: number,
  details?: AgentOperationDetails,
): Response {
  return Response.json(
    {
      apiVersion: "1",
      error: {
        code,
        message:
          code === "NOT_FOUND"
            ? "Not found or no access."
            : "The agent API request was rejected.",
        retryable: false,
        ...(details === undefined ? {} : { details }),
      },
    },
    {
      status,
      headers: {
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        ...(status === 401 ? { "WWW-Authenticate": "Bearer" } : {}),
        ...(status === 405 ? { Allow: "POST" } : {}),
      },
    },
  );
}
