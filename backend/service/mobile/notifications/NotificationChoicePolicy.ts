import type {
  NotificationChoices,
  PicaMobileNotificationEventType,
} from "@/definition/PicaMobileNotifications";

/** Whether a plan event belongs to a selected kind for this account. */
export function wantsPlanEvent(
  choices: NotificationChoices,
  eventType: PicaMobileNotificationEventType,
): boolean {
  if (!choices.receiveNotifications) return false;
  if (choices.planAllStatuses) return true;
  if (eventType === "step_started") return false;
  if (eventType === "run_succeeded") return choices.planCompletions;
  return wantsPlanInterruption(choices);
}

/**
 * Whether an interruption of a plan run belongs to the selected kinds.
 *
 * @param choices - The stored choices of the recipient.
 * @returns `true` while the main switch is on and either "interruptions and
 * blocks" or "all status changes" is selected, as for a failed or cancelled run.
 */
export function wantsPlanInterruption(choices: NotificationChoices): boolean {
  return (
    choices.receiveNotifications &&
    (choices.planAllStatuses || choices.planInterruptions)
  );
}

/** Whether a chat message belongs to a selected kind for this account. */
export function wantsChatMessage(
  choices: NotificationChoices,
  isPicaMessage: boolean,
): boolean {
  return (
    choices.receiveNotifications &&
    (isPicaMessage ? choices.pica : choices.chats)
  );
}
