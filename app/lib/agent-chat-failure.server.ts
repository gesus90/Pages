import { ConversationError } from "@/backend/error/ConversationError";

import type { AgentEmployeeError } from "@/backend/error/AgentEmployeeError";

/**
 * The refusal a request of the chat page answers with when the direct chat
 * with an agent refused it, so the page explains it as it explains the
 * refusal of a conversation.
 *
 * @param error - The refusal of the agent's chat.
 * @returns `not_found` for an agent that does not exist, `forbidden` while
 * nothing can be sent to it, `invalid` for everything the request got wrong.
 */
export function agentChatRefusal(error: AgentEmployeeError): ConversationError {
  switch (error.code) {
    case "notFound":
      return new ConversationError("not_found");
    case "inactive":
    case "busy":
    case "unavailable":
    case "forbidden":
      return new ConversationError("forbidden");
    case "usernameTaken":
    case "invalidInput":
    case "conflict":
    case "modelNotAllowed":
    case "accessUnsupported":
    case "accessAdminRequired":
    case "accessModeRequired":
    case "templateNameTaken":
    case "stopped":
      return new ConversationError("invalid");
  }
}
