import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { afterEach, expect, it, vi } from "vitest";

import { AgentAccessSection } from "@/app/components/users/agents/agent-access-section";
import { ChatBrowserControls } from "@/app/components/chat/browser/chat-browser-controls";
import { ChatBrowserExtras } from "@/app/components/chat/browser/chat-browser-extras";
import { createI18n } from "@/app/lib/i18n";

import type { AgentEmployeeAccess } from "@/definition/AgentEmployee";
import type { PicaBrowserView } from "@/definition/PicaBrowser";
import type { ChatBrowsers } from "@/app/components/chat/browser/use-chat-browser";

afterEach(cleanup);

it.each(["workspace", "yolo", "read_only"] as const)(
  "shows browser permission and profiles derived from the saved %s level",
  (level: AgentEmployeeAccess) => {
    render(
      <I18nextProvider i18n={createI18n("de")}>
        <AgentAccessSection
          value={level}
          savedValue={level}
          onChange={vi.fn()}
          canChange
          environment={{ isIsolationAvailable: true, mcpServers: [] }}
        />
      </I18nextProvider>,
    );
    expect(
      screen.getByText(
        level === "read_only"
          ? "Browser nicht erlaubt · Keine Profile"
          : "Browser erlaubt · Profile: self (eigenes Agent-Konto)",
      ),
    ).toBeTruthy();
  },
);

it("keeps the persisted browser grant visible while an unsaved access change is pending", () => {
  render(
    <I18nextProvider i18n={createI18n("de")}>
      <AgentAccessSection
        value="yolo"
        savedValue="read_only"
        onChange={vi.fn()}
        canChange
        environment={{ isIsolationAvailable: true, mcpServers: [] }}
      />
    </I18nextProvider>,
  );
  expect(
    screen.getByText("Browser nicht erlaubt · Keine Profile"),
  ).toBeTruthy();
});

it("offers pause and stop for an agent browser, without takeover or saving another profile", () => {
  const browser: PicaBrowserView = {
    browserId: "11111111-1111-4111-8111-111111111111",
    task: "Review",
    state: "running",
    url: "https://pages.example.org",
    title: "Pages",
    device: "desktop",
    width: 1280,
    height: 800,
    frameVersion: 0,
    tabs: [],
    actions: [],
    downloads: [],
    handoverReason: null,
    profile: "self",
    areLocalWritesApproved: false,
    updatedAt: "2026-11-13",
    isAgent: true,
    ownerName: "Bakuman",
  };
  const controller: ChatBrowsers = {
    browsers: [browser],
    savedSessions: [],
    error: null,
    command: vi.fn(async () => undefined),
  };
  const i18n = createI18n("en");
  render(
    <I18nextProvider i18n={i18n}>
      <ChatBrowserControls browser={browser} controller={controller} />
      <ChatBrowserExtras browser={browser} controller={controller} />
    </I18nextProvider>,
  );
  fireEvent.click(
    screen.getByRole("button", { name: i18n.t("chat.browser.pause") }),
  );
  fireEvent.click(
    screen.getByRole("button", { name: i18n.t("chat.browser.stop") }),
  );
  expect(controller.command).toHaveBeenCalledWith(browser.browserId, {
    command: "pause",
  });
  expect(controller.command).toHaveBeenCalledWith(browser.browserId, {
    command: "stop",
  });
  expect(
    screen.queryByRole("button", { name: i18n.t("chat.browser.takeover") }),
  ).toBeNull();
  expect(
    screen.queryByRole("button", { name: i18n.t("chat.browser.saveSession") }),
  ).toBeNull();
});
