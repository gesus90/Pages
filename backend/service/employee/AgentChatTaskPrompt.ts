import { AUTOMATION_NAME_LENGTH } from "@/definition/Automation";

import type { AgentChatTaskKind } from "@/definition/AgentChatTask";
import type { AgentChatTaskLanguage } from "./AgentChatTaskSchedule";

/** What the instruction of the automation of a task is composed of. */
export interface AgentChatTaskPromptParts {
  readonly kind: AgentChatTaskKind;
  readonly request: string;
  readonly instruction: string;
  readonly requesterName: string;
  readonly language: AgentChatTaskLanguage;
}

const TEXTS = {
  de: {
    reminder: (name: string) =>
      `[Geplante Erinnerung aus diesem Chat, angelegt von ${name}]`,
    task: (name: string) =>
      `[Geplante Aufgabe aus diesem Chat, angelegt von ${name}]`,
    request: "Ursprüngliche Bitte:",
    reminderText: "Woran du erinnern sollst:",
    instruction: "Deine Anweisung:",
    reminderAction: (name: string) =>
      `Es ist jetzt so weit. Schreibe die Erinnerung als kurze Nachricht an ${name}, beginne mit „Erinnerung:“ und nimm Bezug auf die ursprüngliche Bitte. Deine Antwort erscheint als Nachricht in diesem Chat.`,
    taskAction:
      "Es ist jetzt so weit. Arbeite die Anweisung in diesem Chat ab und antworte mit dem Ergebnis; deine Antwort erscheint als Nachricht in diesem Chat.",
    name: (request: string) => `Chat: ${request}`,
  },
  en: {
    reminder: (name: string) =>
      `[Scheduled reminder from this chat, created by ${name}]`,
    task: (name: string) =>
      `[Scheduled task from this chat, created by ${name}]`,
    request: "Original request:",
    reminderText: "What to remind of:",
    instruction: "Your instruction:",
    reminderAction: (name: string) =>
      `It is time now. Write the reminder as a short message to ${name}, start with "Reminder:" and refer to the original request. Your answer appears as a message in this chat.`,
    taskAction:
      "It is time now. Work on the instruction in this chat and answer with the result; your answer appears as a message in this chat.",
    name: (request: string) => `Chat: ${request}`,
  },
} as const;

/**
 * The instruction the agent receives when its task is due (PAGE-392).
 *
 * @remarks
 * A reminder asks for a reminder text that refers to the original request;
 * a task asks to work on the instruction and to answer with the result.
 * Either answer becomes the agent's message in the chat of the task.
 */
export function chatTaskPrompt(parts: AgentChatTaskPromptParts): string {
  const texts = TEXTS[parts.language];
  const isReminder = parts.kind === "reminder";
  return [
    isReminder
      ? texts.reminder(parts.requesterName)
      : texts.task(parts.requesterName),
    `${texts.request} „${parts.request}“`,
    `${isReminder ? texts.reminderText : texts.instruction} ${parts.instruction}`,
    "",
    isReminder ? texts.reminderAction(parts.requesterName) : texts.taskAction,
  ].join("\n");
}

/** The name of the automation of a task, as the automation list shows it. */
export function chatTaskName(
  request: string,
  language: AgentChatTaskLanguage,
): string {
  const name = TEXTS[language].name(request.replace(/\s+/gu, " ").trim());
  return Array.from(name).slice(0, AUTOMATION_NAME_LENGTH).join("");
}
