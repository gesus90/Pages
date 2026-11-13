import { render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { expect, it, vi } from "vitest";

import { ChatPage } from "@/app/components/chat-page/chat-page";
import { createI18n } from "@/app/lib/i18n";

import { directory, group, participant } from "./chat-page-fixture";

import type { ReactNode } from "react";
import type { VirtualChatDirectory } from "@/definition/VirtualChat";

const fetcher = vi.hoisted(() => ({
  state: "idle",
  data: undefined,
  submit: vi.fn(),
}));
vi.mock("react-router", () => ({
  useFetcher: () => fetcher,
  useRevalidator: () => ({ state: "idle", revalidate: vi.fn() }),
}));
vi.mock("@/app/components/chat-page/chat-page-confidential", () => ({
  useConfidential: () => ({}),
}));
vi.mock("@/app/components/chat-page/use-voice-sending", () => ({
  useVoiceSending: () => ({ failure: null }),
}));
vi.mock("@/app/components/chat-page/chat-page-composer", () => ({
  ChatPageComposer: ({ placeholder }: { placeholder: string }) => (
    <div>{placeholder}</div>
  ),
}));
vi.mock("@/app/components/chat-page/chat-page-drop-zone", () => ({
  ChatPageDropZone: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
}));
vi.mock("@/app/components/chat-page/chat-page-header", () => ({
  ChatPageHeader: () => null,
}));
vi.mock("@/app/components/chat-page/chat-page-history", () => ({
  ChatPageHistory: () => null,
}));
vi.mock("@/app/components/chat-page/chat-page-tool-uses", () => ({
  ChatPageLiveTools: () => null,
}));
vi.mock("@/app/components/chat-page/chat-page-list", () => ({
  ChatPageList: ({
    collapse,
  }: {
    collapse: { readonly isCollapsed: boolean };
  }) => <p>{collapse.isCollapsed ? "list collapsed" : "list expanded"}</p>,
}));
vi.mock("@/app/components/chat-page/chat-page-picker", () => ({
  ChatPagePicker: () => null,
}));
vi.mock("@/app/components/chat-page/content/card-panel", () => ({
  CardOverlay: () => null,
}));
vi.mock("@/app/components/chat-page/content/split-panel", () => ({
  SplitPanel: () => null,
}));
vi.mock("@/app/components/chat-page/content/chat-content-context", () => ({
  ChatContentProvider: ({ children }: { children: ReactNode }) => (
    <>{children}</>
  ),
  useChatContent: () => ({ beside: false }),
}));

function renderPage(contents: VirtualChatDirectory): void {
  render(
    <I18nextProvider i18n={createI18n("en")}>
      <ChatPage directory={contents} />
    </I18nextProvider>,
  );
}

it("shows the empty conversation hint", () => {
  renderPage(directory());
  expect(
    screen.getByText(createI18n("en").t("chatPage.nothingSelected")),
  ).toBeTruthy();
});

it("shows the group composer and paused-agent notice", () => {
  renderPage(directory({ groups: [group("team", { isAgentPaused: true })] }));
  const translate = createI18n("en").t;
  expect(
    screen.getByText(
      translate("chatPage.groupPlaceholder", { name: "Group team" }),
    ),
  ).toBeTruthy();
  expect(
    screen.getByText(translate("chatPage.agentPaused.title")),
  ).toBeTruthy();
});

it("explains that agent conversations are read-only", () => {
  renderPage(
    directory({ groups: [group("team", { isAgentConversation: true })] }),
  );
  expect(
    screen.getByText(createI18n("en").t("chatPage.agentConversationReadOnly")),
  ).toBeTruthy();
});

it("shows the agent composer for an active participant", () => {
  renderPage(directory({ participants: [participant("ada")] }));
  expect(
    screen.getByText(
      createI18n("en").t("chatPage.participantPlaceholder", {
        name: "Name ada",
      }),
    ),
  ).toBeTruthy();
});

it("restores the collapsed list from the view settings of the person (PAGE-325)", () => {
  renderPage(
    directory({
      viewPreferences: {
        cardStates: {},
        splitWidth: null,
        isListCollapsed: true,
      },
    }),
  );
  expect(screen.getByText("list collapsed")).toBeTruthy();
});

it("shows the list expanded without a stored choice and fills the screen", () => {
  renderPage(directory());
  expect(screen.getByText("list expanded")).toBeTruthy();
  expect(
    screen.getByRole("heading", { level: 1 }).closest("section")?.className,
  ).toContain("pages-page-fixed");
});
