import { fireEvent, render, screen, within } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ChatPageHeader } from "@/app/components/chat-page/chat-page-header";
import { ChatPageScheduledTasks } from "@/app/components/chat-page/chat-page-scheduled-tasks";
import { createI18n } from "@/app/lib/i18n";

import { group, participant } from "./chat-page-fixture";

import type { AgentChatTaskView } from "@/definition/AgentChatTask";

const router = vi.hoisted(
  (): {
    fetcher: {
      data: unknown;
      state: string;
      submit: ReturnType<
        typeof vi.fn<(form: FormData, options: { method: string }) => void>
      >;
    };
  } => ({
    fetcher: {
      data: undefined,
      state: "idle",
      submit: vi.fn<(form: FormData, options: { method: string }) => void>(),
    },
  }),
);
vi.mock("react-router", () => ({
  useFetcher: () => router.fetcher,
  useRevalidator: () => ({ state: "idle", revalidate: vi.fn() }),
}));

const i18n = createI18n("en");
const ED = participant("ed", { name: "Ed" });
const BOB = participant("bob", { name: "Bob", kind: "human", role: "" });

const REMINDER: AgentChatTaskView = {
  id: "automation-1",
  agentId: "ed",
  agentName: "Ed",
  kind: "reminder",
  request: "Remind me tomorrow at 9 about the dentist",
  instruction: "Dentist",
  trigger: {
    type: "once",
    at: "2026-11-16T08:00:00.000Z",
    timeZone: "Europe/Berlin",
  },
  isActive: true,
  nextRunAt: "2026-11-16T08:00:00.000Z",
  requesterId: "bob",
  requesterName: "Bob",
  createdAt: "2026-11-15T13:00:00.000Z",
};

const WEEKLY: AgentChatTaskView = {
  ...REMINDER,
  id: "automation-2",
  kind: "task",
  request: "Check the open tickets every Monday",
  trigger: {
    type: "weekly",
    weekdays: [1],
    times: ["09:00"],
    timeZone: "Europe/Berlin",
  },
  isActive: false,
  nextRunAt: null,
};

function submitted(call: number): Record<string, unknown> {
  const formData: unknown = router.fetcher.submit.mock.calls[call]?.[0];
  return formData instanceof FormData
    ? Object.fromEntries(formData.entries())
    : {};
}

function openMenu(name: string): void {
  fireEvent.pointerDown(screen.getByRole("button", { name }), {
    button: 0,
    ctrlKey: false,
  });
}

beforeEach(() => {
  router.fetcher.submit.mockReset();
  router.fetcher.data = undefined;
});

describe("PAGE-392 Geplante Aufgaben in the chat menu", () => {
  it("offers the entry in the group menu and reads the tasks of the group", () => {
    render(
      <I18nextProvider i18n={i18n}>
        <ChatPageHeader
          opened={{
            kind: "group",
            group: group("g", { name: "Team", memberIds: ["ed", "bob"] }),
            members: [ED, BOB],
          }}
          participants={[ED, BOB]}
          isAnswering={false}
          onStop={vi.fn()}
          onAddMember={vi.fn()}
          isMuted={false}
          onToggleMute={vi.fn()}
        />
      </I18nextProvider>,
    );
    openMenu("Group menu");
    fireEvent.click(
      screen.getByRole("menuitem", { name: "Scheduled tasks …" }),
    );
    expect(
      screen.getByRole("dialog", { name: "Scheduled tasks · Team" }),
    ).toBeTruthy();
    expect(submitted(0)).toEqual({ intent: "chat-tasks", conversationId: "g" });
  });

  it("offers the entry in the agent menu of a direct chat and reads the tasks with that agent", () => {
    render(
      <I18nextProvider i18n={i18n}>
        <ChatPageHeader
          opened={{ kind: "participant", participant: ED }}
          participants={[ED, BOB]}
          isAnswering={false}
          onStop={vi.fn()}
          onAddMember={vi.fn()}
          isMuted={null}
          onToggleMute={vi.fn()}
        />
      </I18nextProvider>,
    );
    openMenu("Agent menu");
    fireEvent.click(
      screen.getByRole("menuitem", { name: "Scheduled tasks …" }),
    );
    expect(
      screen.getByRole("dialog", { name: "Scheduled tasks · Ed" }),
    ).toBeTruthy();
    expect(submitted(0)).toEqual({ intent: "chat-tasks", agentId: "ed" });
  });
});

describe("PAGE-392 dialog Geplante Aufgaben", () => {
  function renderDialog(): void {
    render(
      <I18nextProvider i18n={i18n}>
        <ChatPageScheduledTasks
          chat={{ kind: "group", conversationId: "g", name: "Team" }}
          isOpen
          onOpenChange={vi.fn()}
        />
      </I18nextProvider>,
    );
  }

  it("lists each task with its rhythm and next run", () => {
    router.fetcher.data = { ok: true, chatTasks: [REMINDER, WEEKLY] };
    renderDialog();
    const list = screen.getByRole("list", {
      name: "Scheduled tasks of this chat",
    });
    const [first, second] = within(list).getAllByRole("listitem");
    expect(within(first ?? list).getByText(REMINDER.request)).toBeTruthy();
    expect(within(first ?? list).getByText(/^Once: /u)).toBeTruthy();
    expect(within(first ?? list).getByText(/^Next run: /u)).toBeTruthy();
    expect(
      within(first ?? list).getByText("Reminder by Ed for Bob"),
    ).toBeTruthy();
    expect(within(second ?? list).getByText("Monday at 09:00")).toBeTruthy();
    expect(within(second ?? list).getByText("Paused")).toBeTruthy();
    expect(
      within(second ?? list).getByRole("button", { name: "Resume" }),
    ).toBeTruthy();
  });

  it("pauses a task and deletes one only after a second click", () => {
    router.fetcher.data = { ok: true, chatTasks: [REMINDER] };
    renderDialog();
    router.fetcher.submit.mockReset();
    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    expect(submitted(0)).toEqual({
      intent: "chat-task-active",
      conversationId: "g",
      taskId: "automation-1",
      isActive: "false",
    });
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(router.fetcher.submit).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Really delete?" }));
    expect(submitted(1)).toEqual({
      intent: "chat-task-delete",
      conversationId: "g",
      taskId: "automation-1",
    });
  });

  it("says when nothing is planned and why a change was refused", () => {
    router.fetcher.data = { ok: true, chatTasks: [] };
    const { rerender } = render(
      <I18nextProvider i18n={i18n}>
        <ChatPageScheduledTasks
          chat={{ kind: "direct", agentId: "ed", name: "Ed" }}
          isOpen
          onOpenChange={vi.fn()}
        />
      </I18nextProvider>,
    );
    expect(screen.getByText(/Nothing is scheduled in this chat/u)).toBeTruthy();
    router.fetcher.data = {
      ok: false,
      error: "invalidInput",
      taskError: "run_active",
    };
    rerender(
      <I18nextProvider i18n={i18n}>
        <ChatPageScheduledTasks
          chat={{ kind: "direct", agentId: "ed", name: "Ed" }}
          isOpen
          onOpenChange={vi.fn()}
        />
      </I18nextProvider>,
    );
    expect(screen.getByRole("alert").textContent).toBe(
      "The task is running right now; try again in a moment.",
    );
  });
});
