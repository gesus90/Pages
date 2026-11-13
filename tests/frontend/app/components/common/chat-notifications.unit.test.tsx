import { act, fireEvent, render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { useChatNotifications } from "@/app/components/common/use-chat-notifications";
import { useChatToastSelection } from "@/app/components/chat-page/use-chat-toast-selection";
import { showToast, Toaster, ToastProvider } from "@/app/components/ui/toast";
import { createI18n } from "@/app/lib/i18n";

import {
  directory,
  group,
  message,
  participant,
} from "../chat-page/chat-page-fixture";

import type { RouteDataRequest } from "@/app/lib/local-state/route-data";
import type {
  VirtualChatDirectory,
  VirtualChatSelection,
} from "@/definition/VirtualChat";

const boundary = vi.hoisted(() => ({
  read: vi.fn<
    (
      request: RouteDataRequest<VirtualChatDirectory>,
    ) => Promise<VirtualChatDirectory>
  >(),
  navigate: vi.fn(),
}));
vi.mock("@/app/lib/local-state/route-data", () => ({
  readRouteData: boundary.read,
}));
vi.mock("react-router", () => ({ useNavigate: () => boundary.navigate }));

function Watcher({ userId }: { readonly userId: string }): React.ReactElement {
  const refresh = useChatNotifications(userId);
  return <button onClick={refresh}>Refresh</button>;
}

function renderWatcher(userId = "owner"): ReturnType<typeof render> {
  return render(
    <I18nextProvider i18n={createI18n("en")}>
      <ToastProvider key={userId}>
        <Watcher userId={userId} />
        <Toaster />
      </ToastProvider>
    </I18nextProvider>,
  );
}

function conversation(ids: readonly string[]): VirtualChatDirectory {
  return directory({
    participants: [participant("agent")],
    groups: [group("team"), group("muted", { isMuted: true })],
    histories: {
      agent: ids.map((id) => ({ ...message(id), authorId: "agent" })),
      team: ids.map((id) => ({ ...message(`team-${id}`), authorId: "person" })),
      muted: ids.map((id) => ({
        ...message(`muted-${id}`),
        authorId: "person",
      })),
    },
  });
}

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  boundary.read.mockReset();
  boundary.navigate.mockReset();
});
afterEach(() => vi.useRealTimers());

it("establishes a baseline, announces only new incoming messages across pages and opens the exact chat", async () => {
  boundary.read.mockResolvedValue(conversation(["old"]));
  renderWatcher();
  await flush();
  expect(screen.queryByRole("status")).toBeNull();
  boundary.read.mockResolvedValue(conversation(["old", "new", "latest"]));
  fireEvent.click(screen.getByText("Refresh"));
  await flush();
  expect(screen.getAllByText("2 new")).toHaveLength(2);
  expect(screen.queryByText("Group muted")).toBeNull();
  expect(screen.getByText("text latest")).toBeTruthy();
  fireEvent.click(screen.getAllByText("Open")[0]);
  expect(boundary.navigate).toHaveBeenCalledWith("/chat?kind=group&id=team");
  expect(screen.queryByText("Group team")).toBeNull();
  fireEvent.click(screen.getByText("Refresh"));
  await flush();
  expect(screen.getAllByRole("status")).toHaveLength(1);
  expect(screen.getByText("2 new")).toBeTruthy();
});

it("ignores own messages, edits, tool changes and read markers, while discovering a new incoming chat", async () => {
  boundary.read.mockResolvedValue(conversation(["old"]));
  renderWatcher();
  await flush();
  const next = conversation(["old"]);
  boundary.read.mockResolvedValue(
    directory({
      ...next,
      participants: [
        ...next.participants,
        participant("new-person", { unreadCount: 1 }),
      ],
      histories: {
        ...next.histories,
        agent: [
          { ...message("old"), authorId: "agent", content: "edited" },
          message("own"),
        ],
        "new-person": [{ ...message("hello"), authorId: "new-person" }],
      },
    }),
  );
  fireEvent.click(screen.getByText("Refresh"));
  await flush();
  expect(screen.getAllByRole("status")).toHaveLength(1);
  expect(screen.getByText("Name new-person")).toBeTruthy();
  expect(screen.queryByText("edited")).toBeNull();
});

it("polls for agent answers, coalesces in-flight live notices and aborts work when unmounted", async () => {
  let finish: ((snapshot: VirtualChatDirectory) => void) | undefined;
  boundary.read
    .mockImplementationOnce(
      () =>
        new Promise<VirtualChatDirectory>((resolve) => {
          finish = resolve;
        }),
    )
    .mockResolvedValue(conversation(["old", "new"]));
  const view = renderWatcher();
  fireEvent.click(screen.getByText("Refresh"));
  fireEvent.click(screen.getByText("Refresh"));
  expect(boundary.read).toHaveBeenCalledTimes(1);
  await act(async () => {
    finish?.(conversation(["old"]));
  });
  expect(boundary.read).toHaveBeenCalledTimes(2);
  expect(screen.getAllByRole("status")).toHaveLength(2);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(15_000);
  });
  expect(boundary.read).toHaveBeenCalledTimes(3);
  const signal: AbortSignal = boundary.read.mock.calls[0]?.[0].signal;
  view.unmount();
  expect(signal.aborted).toBe(true);
  expect(vi.getTimerCount()).toBe(0);
});

it("retries after a failed background read and drops the previous account's baseline", async () => {
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  boundary.read
    .mockRejectedValueOnce(new TypeError("offline"))
    .mockResolvedValue(conversation(["old"]));
  const first = renderWatcher();
  await flush();
  fireEvent.click(screen.getByText("Refresh"));
  await flush();
  expect(screen.queryByRole("status")).toBeNull();
  first.unmount();
  boundary.read.mockResolvedValue(
    conversation(["old", "other-account-message"]),
  );
  renderWatcher("other");
  await flush();
  expect(screen.queryByRole("status")).toBeNull();
});

function OpenedChat({
  selection,
  requested,
  select,
}: {
  readonly selection: VirtualChatSelection;
  readonly requested?: VirtualChatSelection;
  readonly select: (selection: VirtualChatSelection) => void;
}): null {
  useChatToastSelection({ selection, requested, select });
  return null;
}

it("honors a notification's requested selection and suppresses only the active chat until the page leaves", () => {
  const select = vi.fn();
  const view = render(
    <I18nextProvider i18n={createI18n("en")}>
      <ToastProvider>
        <OpenedChat
          selection={{ kind: "participant", id: "agent" }}
          requested={{ kind: "group", id: "team" }}
          select={select}
        />
        <Toaster />
      </ToastProvider>
    </I18nextProvider>,
  );
  expect(select).toHaveBeenCalledWith({ kind: "group", id: "team" });
  act(() => {
    showToast({
      type: "chat",
      message: "Agent",
      count: 1,
      chat: { kind: "participant", id: "agent" },
    });
    showToast({
      type: "chat",
      message: "Team",
      count: 1,
      chat: { kind: "group", id: "team" },
    });
  });
  expect(screen.queryByText("Agent")).toBeNull();
  expect(screen.getByText("Team")).toBeTruthy();
  view.rerender(
    <I18nextProvider i18n={createI18n("en")}>
      <ToastProvider>
        <Toaster />
      </ToastProvider>
    </I18nextProvider>,
  );
  act(() =>
    showToast({
      type: "chat",
      message: "Agent",
      count: 1,
      chat: { kind: "participant", id: "agent" },
    }),
  );
  expect(screen.getByText("Agent")).toBeTruthy();
});

it("does not announce older history filling the window after a message was deleted", async () => {
  boundary.read.mockResolvedValue(conversation(["old", "latest"]));
  renderWatcher();
  await flush();
  boundary.read.mockResolvedValue(conversation(["older", "old"]));
  fireEvent.click(screen.getByText("Refresh"));
  await flush();
  expect(screen.queryByRole("status")).toBeNull();
});
