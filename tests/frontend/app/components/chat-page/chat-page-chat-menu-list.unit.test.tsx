import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { I18nextProvider } from "react-i18next";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import {
  ChatMenuRequestContext,
  useChatMenuRequestState,
} from "@/app/components/chat-page/chat-menu/chat-menu-request";
import { LONG_PRESS_MS } from "@/app/components/chat-page/chat-menu/use-list-entry-menu";
import { ChatPageHeader } from "@/app/components/chat-page/chat-page-header";
import { ChatContentProvider } from "@/app/components/chat-page/content/chat-content-context";
import {
  GroupEntry,
  ParticipantEntry,
} from "@/app/components/chat-page/chat-page-list-entries";
import { createI18n } from "@/app/lib/i18n";

import { group, participant } from "./chat-page-fixture";

import type { ComponentProps } from "react";

vi.mock("react-router", () => ({
  useFetcher: () => ({ data: undefined, state: "idle", submit: vi.fn() }),
  useRevalidator: () => ({ state: "idle", revalidate: vi.fn() }),
}));

const i18n = createI18n("en");
const ED = participant("ed", { name: "Ed", username: "ed" });
const BOB = participant("bob", {
  name: "Bob",
  kind: "human",
  role: "",
  username: "bobby",
  conversationId: "c-bob",
});
const TEAM = group("g", {
  name: "Team",
  memberIds: ["ed", "bob"],
  isOwner: true,
});

type Opened = ComponentProps<typeof ChatPageHeader>["opened"];

/** The list entries and the head of the opened chat, sharing the request of the chat page. */
function Harness({
  onToggleMute,
}: {
  readonly onToggleMute: () => void;
}): React.ReactElement {
  const menu = useChatMenuRequestState();
  const [selected, setSelected] = useState<string | null>(null);
  let opened: Opened | null = null;
  if (selected === "g") {
    opened = { kind: "group", group: TEAM, members: [ED, BOB] };
  } else if (selected === "bob") {
    opened = { kind: "participant", participant: BOB };
  }
  return (
    <I18nextProvider i18n={i18n}>
      <ChatContentProvider
        conversationId={selected === "bob" ? "c-bob" : selected}
        conversationKey={selected ?? ""}
        directory={{ viewPreferences: { cardStates: {}, splitWidth: null } }}
      >
        <ChatMenuRequestContext value={menu}>
          <ul>
            <li>
              <GroupEntry
                group={TEAM}
                members={[ED, BOB]}
                isSelected={selected === "g"}
                onSelect={() => setSelected("g")}
              />
            </li>
            <li>
              <ParticipantEntry
                participant={BOB}
                isSelected={selected === "bob"}
                onSelect={() => setSelected("bob")}
              />
            </li>
          </ul>
          {opened === null ? null : (
            <ChatPageHeader
              opened={opened}
              participants={[ED, BOB]}
              isAnswering={false}
              onStop={vi.fn()}
              onAddMember={vi.fn()}
              isMuted={false}
              onToggleMute={onToggleMute}
            />
          )}
        </ChatMenuRequestContext>
      </ChatContentProvider>
    </I18nextProvider>
  );
}

function entryButton(name: RegExp): HTMLElement {
  return screen.getByRole("button", { name });
}

function menuEntries(): readonly (string | undefined)[] {
  return Array.from(
    screen
      .getByRole("menu")
      .querySelectorAll<HTMLElement>("[data-chat-menu-entry]"),
  ).map((item) => item.dataset.chatMenuEntry);
}

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    async () => new Response("Not Found", { status: 404 }),
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("opens a group and its chat menu at the mouse with a right click in the list", () => {
  render(<Harness onToggleMute={vi.fn()} />);
  const event = fireEvent.contextMenu(entryButton(/^Team/), {
    clientX: 120,
    clientY: 340,
  });
  // The browser shows no menu of its own.
  expect(event).toBe(false);
  const menu = screen.getByRole("menu");
  expect(within(menu).getByText("Group · 3 members")).toBeTruthy();
  const anchor = document.querySelector<HTMLElement>("[data-chat-menu-anchor]");
  expect(anchor?.style.left).toBe("120px");
  expect(anchor?.style.top).toBe("340px");
  expect(menuEntries()).toEqual([
    "media",
    "context",
    "members",
    "reply",
    "sessions",
    "mute",
    "dissolve",
  ]);
});

it("shows the same menu as the button ☰ of the head", () => {
  render(<Harness onToggleMute={vi.fn()} />);
  fireEvent.contextMenu(entryButton(/^Team/), { clientX: 10, clientY: 10 });
  const fromList = menuEntries();
  fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
  expect(screen.queryByRole("menu")).toBeNull();
  fireEvent.pointerDown(screen.getByRole("button", { name: "Chat menu" }), {
    button: 0,
    ctrlKey: false,
  });
  expect(menuEntries()).toEqual(fromList);
});

it("switches directly in the menu opened from the list", () => {
  const onToggleMute = vi.fn();
  render(<Harness onToggleMute={onToggleMute} />);
  fireEvent.contextMenu(entryButton(/^Bob/), { clientX: 50, clientY: 60 });
  expect(screen.getByText("Direct chat · Person")).toBeTruthy();
  fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "Mute" }));
  expect(onToggleMute).toHaveBeenCalledTimes(1);
});

it("opens the menu below the entry for the context menu key of the keyboard", () => {
  render(<Harness onToggleMute={vi.fn()} />);
  fireEvent.contextMenu(entryButton(/^Bob/), { clientX: 0, clientY: 0 });
  expect(screen.getByRole("menu")).toBeTruthy();
  expect(
    document.querySelector<HTMLElement>("[data-chat-menu-anchor]")?.style.left,
  ).toBe("16px");
});

it("opens the menu with a long press of a finger and swallows the click after it", async () => {
  vi.useFakeTimers();
  render(<Harness onToggleMute={vi.fn()} />);
  const button = entryButton(/^Team/);
  fireEvent.pointerDown(button, {
    pointerType: "touch",
    clientX: 30,
    clientY: 40,
  });
  await act(() => vi.advanceTimersByTime(LONG_PRESS_MS - 1));
  expect(screen.queryByRole("menu")).toBeNull();
  await act(() => vi.advanceTimersByTime(1));
  expect(screen.getByRole("menu")).toBeTruthy();
  fireEvent.pointerUp(button, { pointerType: "touch" });
  // The click the finger fires on release neither closes nor reopens anything.
  const click = fireEvent.click(button);
  expect(click).toBe(false);
  expect(screen.getByRole("menu")).toBeTruthy();
});

it("opens nothing for a short tap or a finger that scrolls", async () => {
  vi.useFakeTimers();
  render(<Harness onToggleMute={vi.fn()} />);
  const button = entryButton(/^Team/);
  fireEvent.pointerDown(button, {
    pointerType: "touch",
    clientX: 30,
    clientY: 40,
  });
  fireEvent.pointerUp(button, { pointerType: "touch" });
  await act(() => vi.advanceTimersByTime(LONG_PRESS_MS));
  expect(screen.queryByRole("menu")).toBeNull();
  fireEvent.pointerDown(button, {
    pointerType: "touch",
    clientX: 30,
    clientY: 40,
  });
  fireEvent.pointerMove(button, {
    pointerType: "touch",
    clientX: 30,
    clientY: 90,
  });
  await act(() => vi.advanceTimersByTime(LONG_PRESS_MS));
  expect(screen.queryByRole("menu")).toBeNull();
});

it("opens the menu as a sheet from the bottom on a phone", () => {
  vi.stubGlobal(
    "matchMedia",
    (query: string) =>
      ({
        matches: query === "(max-width: 767px)",
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }) as unknown as MediaQueryList,
  );
  render(<Harness onToggleMute={vi.fn()} />);
  fireEvent.contextMenu(entryButton(/^Team/), { clientX: 30, clientY: 40 });
  const sheet = screen.getByRole("dialog", { name: "Team" });
  expect(sheet.hasAttribute("data-chat-menu-sheet")).toBe(true);
  expect(within(sheet).getByRole("menu", { name: "Chat menu" })).toBeTruthy();
  expect(document.querySelector("[data-chat-menu-anchor]")).toBeNull();
});

it("moves through the sheet with the arrow keys; a switch keeps it open, an entry closes it", () => {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query === "(max-width: 767px)",
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  const onToggleMute = vi.fn();
  render(<Harness onToggleMute={onToggleMute} />);
  fireEvent.click(entryButton(/^Bob/));
  fireEvent.click(screen.getByRole("button", { name: "Chat menu" }));
  const menu = within(screen.getByRole("dialog", { name: "Bob" })).getByRole(
    "menu",
  );
  const [media] = within(menu).getAllByRole("menuitem");
  media?.focus();
  fireEvent.keyDown(menu, { key: "ArrowDown" });
  expect(document.activeElement?.getAttribute("data-chat-menu-entry")).toBe(
    "embed",
  );
  fireEvent.keyDown(menu, { key: "End" });
  expect(document.activeElement?.getAttribute("data-chat-menu-entry")).toBe(
    "mute",
  );
  fireEvent.click(document.activeElement as HTMLElement);
  expect(onToggleMute).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("dialog", { name: "Bob" })).toBeTruthy();
  fireEvent.click(
    within(menu).getByRole("menuitem", { name: "Embedded websites" }),
  );
  expect(screen.queryByRole("dialog", { name: "Bob" })).toBeNull();
  expect(
    screen.getByRole("dialog", { name: "Conversation settings" }),
  ).toBeTruthy();
});
