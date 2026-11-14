import { act, render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { expect, it, vi } from "vitest";

import { ChatPage } from "@/app/components/chat-page/chat-page";
import { createI18n } from "@/app/lib/i18n";

import { directory, group, participant } from "./chat-page-fixture";

import type { VirtualChatSelection } from "@/definition/VirtualChat";

/** What the mocked head received from the page, and what the mocked input registered. */
const wiring = vi.hoisted(() => ({
  header: {
    onSelect: undefined as
      ((selection: VirtualChatSelection) => void) | undefined,
    onMention: undefined as ((username: string) => void) | undefined,
  },
  mention: vi.fn(),
}));

vi.mock("react-router", () => ({
  useFetcher: () => ({ state: "idle", data: undefined, submit: vi.fn() }),
  useRevalidator: () => ({ state: "idle", revalidate: vi.fn() }),
}));
vi.mock("@/app/components/chat-page/chat-page-confidential", () => ({
  useConfidential: () => ({}),
}));
vi.mock("@/app/components/chat-page/use-voice-sending", () => ({
  useVoiceSending: () => ({ failure: null }),
}));
vi.mock("@/app/components/chat-page/chat-page-composer", async () => {
  const { useEffect } = await import("react");
  return {
    ChatPageComposer: ({
      placeholder,
      mentionRef,
    }: {
      placeholder: string;
      mentionRef?: { current: ((username: string) => void) | null };
    }) => {
      useEffect(() => {
        if (mentionRef) mentionRef.current = wiring.mention;
      });
      return <div>{placeholder}</div>;
    },
  };
});
vi.mock("@/app/components/chat-page/chat-page-drop-zone", () => ({
  ChatPageDropZone: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));
vi.mock("@/app/components/chat-page/chat-page-header", () => ({
  ChatPageHeader: (props: {
    onSelect?: (selection: VirtualChatSelection) => void;
    onMention?: (username: string) => void;
  }) => {
    wiring.header.onSelect = props.onSelect;
    wiring.header.onMention = props.onMention;
    return null;
  },
}));
vi.mock("@/app/components/chat-page/chat-page-history", () => ({
  ChatPageHistory: () => null,
}));
vi.mock("@/app/components/chat-page/chat-page-tool-uses", () => ({
  ChatPageLiveTools: () => null,
}));
vi.mock("@/app/components/chat-page/chat-page-list", () => ({
  ChatPageList: () => null,
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
  ChatContentProvider: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  useChatContent: () => ({ beside: false }),
}));

const i18n = createI18n("en");

function renderPage(): void {
  render(
    <I18nextProvider i18n={i18n}>
      <ChatPage
        directory={directory({
          groups: [group("team", { memberIds: ["ada"] })],
          participants: [participant("ada")],
        })}
      />
    </I18nextProvider>,
  );
}

it("hands the mention of the head to the input field of the opened chat", () => {
  renderPage();
  act(() => wiring.header.onMention?.("ada-user"));
  expect(wiring.mention).toHaveBeenCalledExactlyOnceWith("ada-user");
});

it("lets the head open the direct chat with an agent of the list", () => {
  renderPage();
  expect(
    screen.getByText(
      i18n.t("chatPage.groupPlaceholder", { name: "Group team" }),
    ),
  ).toBeTruthy();
  act(() => wiring.header.onSelect?.({ kind: "participant", id: "ada" }));
  expect(
    screen.getByText(
      i18n.t("chatPage.participantPlaceholder", { name: "Name ada" }),
    ),
  ).toBeTruthy();
});
