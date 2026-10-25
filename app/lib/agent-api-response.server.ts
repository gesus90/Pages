import type { AgentOperationDetails } from "@/definition/PagesAgentOperations";
import type { PagesAgentApiErrorCode } from "@/definition/PagesAgentApi";

/** Sends fixed credential-safe agent API failures. */
export function agentApiFailure(
  code: PagesAgentApiErrorCode,
  status: number,
  details?: AgentOperationDetails,
): Response {
  const attachmentMessage =
    details &&
    "reason" in details &&
    details.reason.startsWith("ticket_attachment_")
      ? "Upload the image or file as an attachment to this ticket. Temporary uploads must be available, unexpired and owned by you; external image addresses are not allowed."
      : null;
  return Response.json(
    {
      apiVersion: "1",
      error: {
        code,
        message:
          attachmentMessage ??
          (code === "NOT_FOUND"
            ? "Not found or no access."
            : "The agent API request was rejected."),
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
