import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { I18nextProvider } from "react-i18next";
import { expect, it, vi } from "vitest";

import { NotificationsCard } from "@/app/components/settings/notifications-card";
import { createI18n } from "@/app/lib/i18n";
import { DEFAULT_NOTIFICATION_CHOICES } from "@/definition/PicaMobileNotifications";
import { DEFAULT_USER_SETTINGS } from "@/definition/Settings";

import type { NotificationChoices } from "@/definition/PicaMobileNotifications";

it("shows and saves each account choice while leaving More enabled", () => {
  const changed = vi.fn();
  function Card(): React.ReactElement {
    const [choices, setChoices] = useState<NotificationChoices>(
      DEFAULT_NOTIFICATION_CHOICES,
    );
    function onChoiceChange(key: keyof NotificationChoices): void {
      changed(key);
      setChoices((current) => ({ ...current, [key]: !current[key] }));
    }
    return (
      <NotificationsCard
        notifications={DEFAULT_USER_SETTINGS.notifications}
        onToggle={vi.fn()}
        choices={choices}
        onChoiceChange={onChoiceChange}
        automationNotification="off"
        onAutomationNotificationChange={vi.fn()}
      />
    );
  }
  render(
    <I18nextProvider i18n={createI18n("de")}>
      <Card />
    </I18nextProvider>,
  );
  expect(screen.getByText("Agent-Pläne")).toBeTruthy();
  expect(
    screen.getByText(
      "Ist ein Chat sichtbar offen, kommen dafür keine Benachrichtigungen.",
    ),
  ).toBeTruthy();
  fireEvent.click(
    screen.getByRole("checkbox", { name: /Alle Statusänderungen/u }),
  );
  expect(changed).toHaveBeenCalledWith("planAllStatuses");
  expect(
    screen.getByRole("checkbox", { name: /Abbrüche und Blockaden/u }),
  ).toHaveProperty("disabled", true);
  expect(
    screen.getByRole("checkbox", { name: /Fertigstellung/u }),
  ).toHaveProperty("checked", true);
  fireEvent.click(
    screen.getByRole("switch", { name: "Benachrichtigungen erhalten" }),
  );
  expect(screen.getByRole("switch", { name: "Chats" })).toHaveProperty(
    "disabled",
    true,
  );
  expect(
    screen.getByRole("checkbox", { name: /Läufe anderer im Team/u }),
  ).toHaveProperty("disabled", true);
  expect(
    screen.getByRole("switch", { name: "E-Mail-Benachrichtigungen" }),
  ).toHaveProperty("disabled", false);
});
