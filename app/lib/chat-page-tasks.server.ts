import { AgentChatTaskError } from "@/backend/error/AgentChatTaskError";

import type { AgentChatTaskService } from "@/backend/service/employee/AgentChatTaskService";
import type { AgentChatTaskPageChat } from "@/backend/service/employee/AgentChatTaskService";
import type {
  AgentChatTaskErrorCode,
  AgentChatTaskView,
} from "@/definition/AgentChatTask";
import type { User } from "@/definition/User";

/** The changes of the dialog "Geplante Aufgaben" (PAGE-392). */
export const CHAT_TASK_INTENTS = [
  "chat-tasks",
  "chat-task-active",
  "chat-task-delete",
] as const;

/** A change of the dialog "Geplante Aufgaben". */
export type ChatTaskIntent = (typeof CHAT_TASK_INTENTS)[number];

/** Whether an intent belongs to the dialog "Geplante Aufgaben". */
export function isChatTaskIntent(intent: string): intent is ChatTaskIntent {
  return CHAT_TASK_INTENTS.some((candidate) => candidate === intent);
}

/** The HTTP status of a refused task change. */
export const CHAT_TASK_STATUS: Readonly<Record<AgentChatTaskErrorCode, number>> =
  {
    not_found: 404,
    forbidden: 403,
    limit_reached: 409,
    time_in_past: 409,
    invalid: 400,
    run_active: 409,
  };

/** The refusal of a task change as the page reads it; `null` for any other error. */
export function chatTaskFailure(error: unknown): AgentChatTaskErrorCode | null {
  return error instanceof AgentChatTaskError ? error.code : null;
}

/** The chat the request names: a group by `conversationId`, a direct chat by `agentId`. */
function readChat(formData: FormData): AgentChatTaskPageChat {
  const conversationId = formData.get("conversationId");
  if (typeof conversationId === "string" && conversationId !== "")
    return { kind: "group", conversationId };
  const agentId = formData.get("agentId");
  if (typeof agentId === "string" && agentId !== "")
    return { kind: "direct", agentId };
  throw new AgentChatTaskError("invalid");
}

/**
 * Lists, pauses, resumes or deletes the scheduled tasks of a chat
 * (PAGE-392); every change answers the list of the chat as it is now.
 *
 * @param service - The scheduled tasks of chats.
 * @param person - The signed-in person, who must be in the chat.
 * @param intent - The change.
 * @param formData - The fields of the request.
 */
export async function runChatTaskIntent(
  service: Pick<
    AgentChatTaskService,
    "forChat" | "setActiveForPerson" | "removeForPerson"
  >,
  person: User,
  intent: ChatTaskIntent,
  formData: FormData,
): Promise<{ readonly chatTasks: readonly AgentChatTaskView[] }> {
  const chat = readChat(formData);
  if (intent === "chat-task-active")
    await service.setActiveForPerson(person, {
      taskId: formData.get("taskId"),
      isActive: formData.get("isActive") === "true",
    });
  if (intent === "chat-task-delete")
    await service.removeForPerson(person, formData.get("taskId"));
  return { chatTasks: await service.forChat(person, chat) };
}
