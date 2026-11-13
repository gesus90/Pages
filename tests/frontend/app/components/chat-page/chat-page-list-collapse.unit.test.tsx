import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { ChatPageList } from "@/app/components/chat-page/chat-page-list";
import { formatUnreadBadge } from "@/app/components/chat-page/chat-page-list-rail";
import {
  isListShortcut,
  useChatListCollapse,
} from "@/app/components/chat-page/use-chat-list-collapse";
import { useChatPage } from "@/app/components/chat-page/use-chat-page";
import { createI18n } from "@/app/lib/i18n";

import { directory, group, participant } from "./chat-page-fixture";

const fetcher = vi.hoisted(() => ({
  state: "idle",
  data: undefined,
  submit: vi.fn(),
}));
vi.mock("react-router", () => ({
  useFetcher: () => fetcher,
  useRevalidator: () => ({ state: "idle", revalidate: vi.fn() }),
}));
vi.mock("@/app/components/chat-page/chat-page-contact-dialog", () => ({
  ChatPageContactDialog: () => null,
}));
vi.mock("@/app/components/chat-page/chat-page-create-dialog", () => ({
  ChatPageCreateDialog: () => null,
}));

const contents = directory({
  groups: [
    group("team", { memberIds: ["ada"], unreadCount: 2 }),
    group("quiet", { unreadCount: 140, isMuted: true }),
  ],
  participants: [participant("ada", { unreadCount: 1 }), participant("bob")],
});

function ListFixture({
  isStoredCollapsed,
}: {
  readonly isStoredCollapsed: boolean;
}): React.ReactElement {
  const page = useChatPage(contents);
  const collapse = useChatListCollapse(isStoredCollapsed);
  return (
    <>
      <ChatPageList page={page} directory={contents} collapse={collapse} />
      <footer data-chat-composer="">
        <div contentEditable="true" data-testid="composer" />
      </footer>
    </>
  );
}

function renderList(isStoredCollapsed = false): void {
  render(
    <I18nextProvider i18n={createI18n("en")}>
      <ListFixture isStoredCollapsed={isStoredCollapsed} />
    </I18nextProvider>,
  );
}

/** The stored states, in the order the page sent them. */
function storedStates(): string[] {
  return fetcher.submit.mock.calls.map(([formData]: [FormData]) => {
    expect(formData.get("intent")).toBe("list-collapsed");
    return String(formData.get("isCollapsed"));
  });
}

function pressShortcut(target: EventTarget = window): void {
  fireEvent.keyDown(target, { key: "L", ctrlKey: true, shiftKey: true });
}

beforeEach(() => {
  fetcher.submit.mockReset();
  // The list shows from 768 px on; the tests run as a desktop browser.
  vi.spyOn(window, "matchMedia").mockImplementation(
    (query: string) =>
      ({
        matches: true,
        media: query,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      }) as unknown as MediaQueryList,
  );
});

afterEach(() => vi.restoreAllMocks());

it("collapses the list with its toggle, keeps the focus there and stores the state", () => {
  renderList();
  const list = screen.getByRole("complementary", {
    name: "Groups and participants",
  });
  const toggle = screen.getByRole("button", { name: "Collapse list" });
  expect(toggle.getAttribute("aria-expanded")).toBe("true");
  expect(toggle.getAttribute("aria-controls")).toBe(list.id);
  expect(screen.getByRole("searchbox")).toBeTruthy();

  toggle.focus();
  fireEvent.click(toggle);

  const expandToggle = screen.getByRole("button", { name: "Expand list" });
  expect(expandToggle).toBe(toggle);
  expect(document.activeElement).toBe(toggle);
  expect(toggle.getAttribute("aria-expanded")).toBe("false");
  expect(list.getAttribute("data-collapsed")).toBe("true");
  expect(screen.queryByRole("searchbox")).toBeNull();
  expect(screen.getByTestId("chat-list-rail")).toBeTruthy();

  fireEvent.click(toggle);
  expect(screen.getByRole("button", { name: "Collapse list" })).toBe(toggle);
  expect(storedStates()).toEqual(["true", "false"]);
});

it("starts collapsed when the person collapsed the list before reloading", () => {
  renderList(true);
  expect(screen.getByRole("button", { name: "Expand list" })).toBeTruthy();
  expect(screen.getByTestId("chat-list-rail")).toBeTruthy();
  expect(fetcher.submit).not.toHaveBeenCalled();
});

it("shows every conversation with its unread count in the bar", () => {
  renderList(true);
  const rail = screen.getByTestId("chat-list-rail");
  const groups = within(rail).getByRole("list", { name: "Groups" });
  const participants = within(rail).getByRole("list", {
    name: "Participants",
  });

  expect(
    within(groups).getByRole("button", { name: "Group team · 2 unread" }),
  ).toBeTruthy();
  expect(
    within(groups).getByRole("button", { name: "Group quiet · 140 unread" }),
  ).toBeTruthy();
  expect(
    within(participants).getByRole("button", { name: "Name ada · 1 unread" }),
  ).toBeTruthy();
  expect(
    within(participants).getByRole("button", { name: "Name bob" }),
  ).toBeTruthy();

  const badges = within(rail).getAllByTestId("chat-rail-badge");
  expect(badges.map((badge) => badge.textContent)).toEqual(["2", "99+", "1"]);
  expect(badges[0]?.className).toContain("bg-primary");
  expect(badges[1]?.className).toContain("bg-muted");
});

it("formats counts from 100 on as 99+", () => {
  expect(formatUnreadBadge(1)).toBe("1");
  expect(formatUnreadBadge(99)).toBe("99");
  expect(formatUnreadBadge(100)).toBe("99+");
});

it("keeps one tab stop in the bar and moves with the arrow keys, Home and End", () => {
  renderList(true);
  const rail = screen.getByTestId("chat-list-rail");
  const entries = within(rail).getAllByRole("button");
  expect(entries.map((entry) => entry.tabIndex)).toEqual([0, -1, -1, -1]);
  expect(entries[0]?.getAttribute("aria-current")).toBe("true");

  entries[0]?.focus();
  fireEvent.keyDown(entries[0] ?? rail, { key: "ArrowDown" });
  expect(document.activeElement).toBe(entries[1]);
  fireEvent.keyDown(entries[1] ?? rail, { key: "End" });
  expect(document.activeElement).toBe(entries[3]);
  fireEvent.keyDown(entries[3] ?? rail, { key: "Home" });
  expect(document.activeElement).toBe(entries[0]);
});

it("shows the tooltip on hover and focus and opens a conversation from the bar", () => {
  renderList(true);
  const ada = screen.getByRole("button", { name: "Name ada · 1 unread" });

  fireEvent.mouseEnter(ada);
  expect(screen.getByTestId("chat-rail-tooltip").textContent).toBe(
    "Name ada · 1 unread",
  );
  fireEvent.mouseLeave(ada);
  expect(screen.queryByTestId("chat-rail-tooltip")).toBeNull();

  fireEvent.click(ada, { detail: 1 });
  expect(ada.getAttribute("aria-current")).toBe("true");
  expect(ada.tabIndex).toBe(0);
});

it("puts the focus into the input when Enter opens a conversation", () => {
  const frames: FrameRequestCallback[] = [];
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    frames.push(callback);
    return frames.length;
  });
  renderList(true);
  const bob = screen.getByRole("button", { name: "Name bob" });

  bob.focus();
  fireEvent.click(bob, { detail: 0 });
  expect(bob.getAttribute("aria-current")).toBe("true");
  act(() => frames.shift()?.(0));
  expect(document.activeElement).toBe(screen.getByTestId("composer"));
});

it("opens the list from the magnifier and puts the focus into the search", () => {
  renderList(true);
  fireEvent.click(
    screen.getByRole("button", { name: "Search groups and participants" }),
  );
  const search = screen.getByRole("searchbox");
  expect(document.activeElement).toBe(search);
  expect(screen.getByRole("button", { name: "Collapse list" })).toBeTruthy();
  expect(storedStates()).toEqual(["false"]);
});

it("collapses and expands with Ctrl+Shift+L, also from the input", () => {
  renderList();
  pressShortcut(screen.getByTestId("composer"));
  expect(screen.getByRole("button", { name: "Expand list" })).toBeTruthy();
  pressShortcut();
  expect(screen.getByRole("button", { name: "Collapse list" })).toBeTruthy();
  fireEvent.keyDown(window, { key: "l", metaKey: true, shiftKey: true });
  expect(screen.getByRole("button", { name: "Expand list" })).toBeTruthy();
  expect(storedStates()).toEqual(["true", "false", "true"]);
});

it("ignores the shortcut on phones, where the page shows its selection", () => {
  vi.mocked(window.matchMedia).mockImplementation(
    (query: string) =>
      ({
        matches: false,
        media: query,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      }) as unknown as MediaQueryList,
  );
  renderList();
  pressShortcut();
  expect(screen.getByRole("button", { name: "Collapse list" })).toBeTruthy();
  expect(fetcher.submit).not.toHaveBeenCalled();
});

it("recognizes only Ctrl or Command with Shift and L as the shortcut", () => {
  const keys = {
    ctrlKey: false,
    metaKey: false,
    shiftKey: true,
    altKey: false,
  };
  expect(isListShortcut({ ...keys, key: "L", ctrlKey: true })).toBe(true);
  expect(isListShortcut({ ...keys, key: "l", metaKey: true })).toBe(true);
  expect(isListShortcut({ ...keys, key: "L" })).toBe(false);
  expect(
    isListShortcut({ ...keys, key: "L", ctrlKey: true, shiftKey: false }),
  ).toBe(false);
  expect(
    isListShortcut({ ...keys, key: "L", ctrlKey: true, altKey: true }),
  ).toBe(false);
  expect(isListShortcut({ ...keys, key: "K", ctrlKey: true })).toBe(false);
});
