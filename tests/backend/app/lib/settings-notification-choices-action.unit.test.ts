import { expect, it, vi } from "vitest";

import { handleUpdateNotificationChoices } from "@/app/lib/settings-actions/settings-notification-choices-action.server";
import {
  DEFAULT_NOTIFICATION_CHOICES,
  NOTIFICATION_CHOICE_KEYS,
} from "@/definition/PicaMobileNotifications";

import { partial } from "./service-wiring-fakes";

import type { SettingsActionContext } from "@/app/lib/settings-actions/settings-action-support.server";

it("saves every account choice and refuses an incomplete form", async () => {
  const changeChoices = vi.fn(async () => DEFAULT_NOTIFICATION_CHOICES);
  const formData = new FormData();
  for (const key of NOTIFICATION_CHOICE_KEYS) {
    formData.set(key, DEFAULT_NOTIFICATION_CHOICES[key] ? "on" : "off");
  }
  formData.set("chats", "off");
  const context = partial<SettingsActionContext>({
    user: partial<SettingsActionContext["user"]>({ id: "owner" }),
    formData,
    services: partial<SettingsActionContext["services"]>({
      picaMobileNotifications: partial<
        SettingsActionContext["services"]["picaMobileNotifications"]
      >({ changeChoices }),
    }),
  });
  await handleUpdateNotificationChoices(context);
  expect(changeChoices).toHaveBeenCalledWith("owner", {
    ...DEFAULT_NOTIFICATION_CHOICES,
    chats: false,
  });
  formData.delete("planCompletions");
  await expect(handleUpdateNotificationChoices(context)).rejects.toMatchObject({
    status: 400,
  });
});
