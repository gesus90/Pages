import { badRequest } from "./settings-action-support.server";

import type { SettingsActionHandler } from "./settings-action-support.server";
import type { NotificationChoices } from "@/definition/PicaMobileNotifications";

function readChoice(
  formData: FormData,
  key: keyof NotificationChoices,
): boolean {
  const choice = formData.get(key);
  if (choice !== "on" && choice !== "off") throw badRequest();
  return choice === "on";
}

/** Saves one account notification choice from the Pages card. */
export const handleUpdateNotificationChoices: SettingsActionHandler = async ({
  user,
  formData,
  services,
}) => {
  const choices: NotificationChoices = {
    receiveNotifications: readChoice(formData, "receiveNotifications"),
    chats: readChoice(formData, "chats"),
    pica: readChoice(formData, "pica"),
    planInterruptions: readChoice(formData, "planInterruptions"),
    planCompletions: readChoice(formData, "planCompletions"),
    planAllStatuses: readChoice(formData, "planAllStatuses"),
    teamRuns: readChoice(formData, "teamRuns"),
  };
  await services.picaMobileNotifications.changeChoices(user.id, choices);
  return null;
};
