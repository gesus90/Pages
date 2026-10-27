import { WorkItemValidationError } from "@/backend/error/WorkItemErrors";
import { AgentOperationError } from "@/backend/error/AgentOperationError";
import {
  WikiAccessDeniedError,
  WikiPageNotFoundError,
  WikiValidationError,
} from "@/backend/error/WikiErrors";

import { translateAgentTicketError } from "./AgentTicketErrors";

/** Keeps both attachment domains' authorization, conflict and validation failures actionable at the Agent API. */
export function translateAssetWriteError(error: unknown): unknown {
  if (
    error instanceof WorkItemValidationError &&
    error.code === "attachmentTooLarge"
  )
    return new AgentOperationError("PAYLOAD_TOO_LARGE");
  if (error instanceof WikiValidationError && error.code === "fileTooLarge")
    return new AgentOperationError("PAYLOAD_TOO_LARGE");
  if (error instanceof WikiAccessDeniedError)
    return new AgentOperationError("FORBIDDEN");
  if (error instanceof WikiPageNotFoundError)
    return new AgentOperationError("NOT_FOUND");
  if (error instanceof WikiValidationError)
    return new AgentOperationError("INVALID_REQUEST");
  return translateAgentTicketError(error);
}
