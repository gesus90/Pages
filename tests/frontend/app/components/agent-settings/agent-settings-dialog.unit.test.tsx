import { fireEvent, render, screen, within } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { afterEach, expect, it, vi } from "vitest";

import { AgentSettingsDialog } from "@/app/components/agent-settings/agent-settings-dialog";
import { createI18n } from "@/app/lib/i18n";

import {
  deferred,
  sessionOverview,
  sessionView,
  stubSessionEndpoint,
} from "./agent-session-fixture";

import type { ComponentProps } from "react";
import type { AgentChatSessionResponse } from "@/definition/AgentChatSession";

const i18n = createI18n("en");

const WORKING_GROUP = sessionView("s-group", {
  state: "working",
  contextPercent: 58,
  waitingMessages: 2,
  tokens: 151_000,
  lastActivityAt: new Date().toISOString(),
  chat: { kind: "group", id: "g1", name: "Pages Team", isConfidential: false },
});
const READY_DIRECT = sessionView("s-direct", {
  lastActivityAt: new Date(Date.now() - 4 * 60_000).toISOString(),
});
const RESTART_DIRECT = sessionView("s-restart", {
  state: "restart_needed",
  contextPercent: 82,
  waitingMessages: 1,
  tokens: 240_000,
  chat: { kind: "direct", id: "person-2", name: "Mei", isConfidential: false },
});
const RESTING_CONFIDENTIAL = sessionView("s-rest", {
  state: "resting",
  contextPercent: 9,
  tokens: 12_000,
  chat: { kind: "direct", id: "person-3", name: "Anton", isConfidential: true },
});
const FULL = sessionOverview({
  sessions: [WORKING_GROUP, READY_DIRECT, RESTART_DIRECT, RESTING_CONFIDENTIAL],
  openSessions: 2,
  restingSessions: 3,
  tokensToday: 539_000,
});

function answer(overview = FULL): AgentChatSessionResponse {
  return { ok: true, overview };
}

function renderDialog(
  props: Partial<ComponentProps<typeof AgentSettingsDialog>> = {},
): { readonly onClose: ReturnType<typeof vi.fn> } {
  const onClose = vi.fn();
  render(
    <I18nextProvider i18n={i18n}>
      <AgentSettingsDialog agentId="ed" onClose={onClose} {...props} />
    </I18nextProvider>,
  );
  return { onClose };
}

async function sessionRows(): Promise<HTMLElement[]> {
  const table = await screen.findByRole("table", {
    name: "Chat sessions of Ed",
  });
  return within(table).getAllByRole("row").slice(1);
}

function isDisabled(element: HTMLElement): boolean {
  return element.hasAttribute("disabled");
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it("reads the sessions of the agent from the endpoint with the cookies of the page", async () => {
  const { calls } = stubSessionEndpoint(() => answer());
  renderDialog({ agentId: "ed/1" });
  await sessionRows();
  expect(calls).toHaveLength(1);
  expect(calls[0]?.url).toBe("/chat-page-api/agent-sessions?agentId=ed%2F1");
  expect(calls[0]?.method).toBe("GET");
  expect(calls[0]?.headers.get("Accept")).toBe("application/json");
  expect(calls[0]?.headers.get("X-Pages-Data-Request")).toBe("1");
});

it("opens nothing without an agent", () => {
  const { calls } = stubSessionEndpoint(() => answer());
  renderDialog({ agentId: null });
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(calls).toHaveLength(0);
});

it("lists every session with state, context, waiting messages and tokens", async () => {
  stubSessionEndpoint(() => answer());
  renderDialog();
  const [groupRow, directRow, restartRow, restingRow] = await sessionRows();
  expect(within(groupRow).getByText("Group “Pages Team”")).toBeTruthy();
  expect(within(groupRow).getByText("Group")).toBeTruthy();
  expect(within(groupRow).getByText("working")).toBeTruthy();
  expect(within(groupRow).getByText("151 k")).toBeTruthy();
  expect(within(groupRow).getByText("2")).toBeTruthy();
  expect(
    within(groupRow).getByRole("meter").getAttribute("aria-valuenow"),
  ).toBe("58");
  expect(within(directRow).getByText("Direct · Igor")).toBeTruthy();
  expect(within(directRow).getByText("ready")).toBeTruthy();
  expect(await within(directRow).findByText("4 minutes ago")).toBeTruthy();
  expect(within(restartRow).getByText("restart needed")).toBeTruthy();
  expect(within(restingRow).getByText("resting")).toBeTruthy();
  expect(within(restingRow).getByText("confidential")).toBeTruthy();
  expect(within(restingRow).getByText("12 k")).toBeTruthy();
});

it("shows the cards for open sessions, tokens and behavior", async () => {
  stubSessionEndpoint(() => answer());
  renderDialog();
  await sessionRows();
  expect(screen.getByText("Open sessions")).toBeTruthy();
  expect(screen.getByText("5")).toBeTruthy();
  expect(screen.getByText("2 active · 3 resting")).toBeTruthy();
  expect(screen.getByText("Tokens today")).toBeTruthy();
  expect(screen.getByText("539 k")).toBeTruthy();
  expect(screen.getByDisplayValue("30")).toBeTruthy();
  expect(screen.getByDisplayValue("80")).toBeTruthy();
});

it("highlights the row of the opened chat by kind and ID", async () => {
  stubSessionEndpoint(() => answer());
  renderDialog({ currentChat: { kind: "group", id: "g1" } });
  const [groupRow, directRow] = await sessionRows();
  expect(groupRow.getAttribute("aria-current")).toBe("true");
  expect(within(groupRow).getByText("this chat")).toBeTruthy();
  expect(directRow.getAttribute("aria-current")).toBeNull();
  expect(screen.getAllByText("this chat")).toHaveLength(1);
});

it("highlights the row of the opened chat by its session when the chat ID is not known", async () => {
  stubSessionEndpoint(() => answer());
  renderDialog({ currentChat: { sessionId: "s-direct" } });
  const [groupRow, directRow] = await sessionRows();
  expect(directRow.getAttribute("aria-current")).toBe("true");
  expect(groupRow.getAttribute("aria-current")).toBeNull();
});

it("shows the context red at the threshold and for a session that needs its restart", async () => {
  stubSessionEndpoint(() => answer());
  renderDialog();
  const [groupRow, , restartRow] = await sessionRows();
  const fill = (row: HTMLElement): string =>
    within(row).getByRole("meter").firstElementChild?.className ?? "";
  expect(fill(restartRow)).toContain("bg-destructive");
  expect(fill(groupRow)).not.toContain("bg-destructive");
});

it("shows the head with name, subtitle and the four tabs", async () => {
  stubSessionEndpoint(() => answer());
  renderDialog({ identity: { name: "Ed", subtitle: "Developer · Model" } });
  expect(
    screen.getByRole("heading", { name: "Ed · Agent settings" }),
  ).toBeTruthy();
  expect(screen.getByText("Developer · Model")).toBeTruthy();
  await sessionRows();
  expect(
    screen.getByRole("tab", { name: "Sessions" }).getAttribute("aria-selected"),
  ).toBe("true");
});

it("names the agent from the sessions when the caller knows no identity", async () => {
  stubSessionEndpoint(() => answer());
  renderDialog();
  expect(screen.getByRole("heading", { name: "Agent settings" })).toBeTruthy();
  await sessionRows();
  expect(
    screen.getByRole("heading", { name: "Ed · Agent settings" }),
  ).toBeTruthy();
});

it("shows the tabs of functions that do not exist yet as off, with a hint, and the Logbook as a working tab", async () => {
  stubSessionEndpoint(() => answer());
  renderDialog({ initialTab: "dreaming" });
  await sessionRows();
  for (const name of ["Dreaming", "Lessons & recipes"]) {
    const tab = screen.getByRole("tab", { name });
    expect(isDisabled(tab)).toBe(true);
    expect(tab.getAttribute("title")).toBe(
      "Follows with the respective feature.",
    );
  }
  const logbook = screen.getByRole("tab", { name: "Logbook" });
  expect(isDisabled(logbook)).toBe(false);
  expect(logbook.getAttribute("title")).toBeNull();
  expect(
    screen.getByText(
      "Dreaming and lessons & recipes follow with the respective feature.",
    ),
  ).toBeTruthy();
  // A tab that does not work opens "Sessions" instead.
  expect(
    screen.getByRole("tab", { name: "Sessions" }).getAttribute("aria-selected"),
  ).toBe("true");
});

it("shows a hint while the sessions load", () => {
  stubSessionEndpoint(
    () => new Promise<AgentChatSessionResponse>(() => undefined),
  );
  renderDialog();
  expect(screen.getByText("Loading the sessions …")).toBeTruthy();
});

it("says that the agent has no sessions yet and still offers the settings", async () => {
  stubSessionEndpoint(() => answer(sessionOverview()));
  renderDialog();
  expect(
    await screen.findByText("This agent has no sessions yet."),
  ).toBeTruthy();
  expect(screen.queryByRole("table")).toBeNull();
  expect(screen.getByLabelText("Rest after")).toBeTruthy();
});

it("explains why the sessions cannot be read and tries again on request", async () => {
  let attempt = 0;
  const { calls } = stubSessionEndpoint(() => {
    attempt += 1;
    return attempt === 1
      ? Response.json({ ok: false, error: "forbidden" }, { status: 403 })
      : answer();
  });
  renderDialog();
  expect((await screen.findByRole("alert")).textContent).toBe(
    "You are not allowed to do this.",
  );
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  await sessionRows();
  expect(calls).toHaveLength(2);
});

it("reports an unreachable endpoint and an unreadable answer as unavailable", async () => {
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.stubGlobal("fetch", () => Promise.reject(new TypeError("offline")));
  renderDialog();
  expect((await screen.findByRole("alert")).textContent).toContain(
    "not available right now",
  );
  vi.unstubAllGlobals();
  stubSessionEndpoint(() =>
    Response.json({ ok: true, overview: { agentId: 1 } }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  await screen.findByText("Loading the sessions …");
  expect((await screen.findByRole("alert")).textContent).toContain(
    "not available right now",
  );
});

it("sends the number entries of the behavior card with save-settings", async () => {
  const saved = sessionOverview({
    settings: { idleMinutes: 45, restartPercent: 70 },
    sessions: [READY_DIRECT],
  });
  const { calls } = stubSessionEndpoint((call) =>
    call.method === "POST" ? answer(saved) : answer(),
  );
  renderDialog();
  await sessionRows();
  fireEvent.change(screen.getByLabelText("Rest after"), {
    target: { value: "45" },
  });
  fireEvent.change(screen.getByLabelText("Restart automatically from"), {
    target: { value: "70" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(await screen.findByText("Settings saved.")).toBeTruthy();
  expect(calls[1]).toMatchObject({
    url: "/chat-page-api/agent-sessions",
    method: "POST",
    fields: {
      intent: "save-settings",
      agentId: "ed",
      idleMinutes: "45",
      restartPercent: "70",
    },
  });
  expect(calls[1]?.fields.sessionId).toBeUndefined();
  // The table now shows the overview the server answered with.
  expect(await sessionRows()).toHaveLength(1);
  expect(screen.getByDisplayValue("45")).toBeTruthy();
});

it("refuses entries outside the ranges of the contract before anything is sent", async () => {
  const { calls } = stubSessionEndpoint(() => answer());
  renderDialog();
  await sessionRows();
  const save = screen.getByRole("button", { name: "Save" });
  expect(isDisabled(save)).toBe(false);
  fireEvent.change(screen.getByLabelText("Rest after"), {
    target: { value: "0" },
  });
  expect(screen.getByRole("alert").textContent).toBe(
    "Enter whole minutes from 1 to 1440.",
  );
  expect(isDisabled(save)).toBe(true);
  fireEvent.change(screen.getByLabelText("Rest after"), {
    target: { value: "60" },
  });
  fireEvent.change(screen.getByLabelText("Restart automatically from"), {
    target: { value: "96" },
  });
  expect(screen.getByRole("alert").textContent).toBe(
    "Enter a percentage from 10 to 95.",
  );
  expect(isDisabled(save)).toBe(true);
  fireEvent.change(screen.getByLabelText("Restart automatically from"), {
    target: { value: "1.5" },
  });
  expect(isDisabled(save)).toBe(true);
  fireEvent.click(save);
  expect(calls).toHaveLength(1);
});

it("keeps the entries read-only when the viewer may not change the settings", async () => {
  stubSessionEndpoint(() =>
    answer(sessionOverview({ canChangeSettings: false })),
  );
  renderDialog();
  expect(
    await screen.findByText("You can view these settings but not change them."),
  ).toBeTruthy();
  expect(screen.getByLabelText("Rest after").hasAttribute("readonly")).toBe(
    true,
  );
  expect(
    screen
      .getByLabelText("Restart automatically from")
      .hasAttribute("readonly"),
  ).toBe(true);
  expect(isDisabled(screen.getByRole("button", { name: "Save" }))).toBe(true);
});

it("sends the intent and the session of the button and shows the fresh overview", async () => {
  const afterwards = sessionOverview({
    sessions: [{ ...READY_DIRECT, state: "resting", contextPercent: 5 }],
  });
  const { calls } = stubSessionEndpoint((call) =>
    call.method === "POST" ? answer(afterwards) : answer(),
  );
  renderDialog();
  await sessionRows();
  fireEvent.click(
    screen.getByRole("button", { name: "Summarize session: Direct · Igor" }),
  );
  const [row] = await waitForRows(1);
  expect(within(row).getByText("resting")).toBeTruthy();
  expect(calls[1]?.fields).toEqual({
    intent: "summarize",
    agentId: "ed",
    sessionId: "s-direct",
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Restart session: Direct · Igor" }),
  );
  await waitForCalls(calls, 3);
  expect(calls[2]?.fields.intent).toBe("restart");
});

async function waitForRows(count: number): Promise<HTMLElement[]> {
  const table = await screen.findByRole("table");
  await vi.waitFor(() => {
    expect(within(table).getAllByRole("row")).toHaveLength(count + 1);
  });
  return within(table).getAllByRole("row").slice(1);
}

async function waitForCalls(
  calls: readonly unknown[],
  count: number,
): Promise<void> {
  await vi.waitFor(() => expect(calls).toHaveLength(count));
}

it("stops only a session that works", async () => {
  const { calls } = stubSessionEndpoint(() => answer());
  renderDialog();
  await sessionRows();
  expect(
    isDisabled(
      screen.getByRole("button", { name: "Stop session: Direct · Igor" }),
    ),
  ).toBe(true);
  fireEvent.click(
    screen.getByRole("button", { name: "Stop session: Group “Pages Team”" }),
  );
  await waitForCalls(calls, 2);
  expect(calls[1]?.fields).toEqual({
    intent: "stop",
    agentId: "ed",
    sessionId: "s-group",
  });
});

it("holds every button while a change runs", async () => {
  const pending = deferred<AgentChatSessionResponse>();
  stubSessionEndpoint((call) =>
    call.method === "POST" ? pending.promise : answer(),
  );
  renderDialog();
  await sessionRows();
  fireEvent.click(
    screen.getByRole("button", { name: "Restart session: Direct · Igor" }),
  );
  await vi.waitFor(() =>
    expect(
      isDisabled(
        screen.getByRole("button", {
          name: "Summarize session: Direct · Igor",
        }),
      ),
    ).toBe(true),
  );
  expect(isDisabled(screen.getByRole("button", { name: "Save" }))).toBe(true);
  pending.resolve(answer());
  await vi.waitFor(() =>
    expect(
      isDisabled(
        screen.getByRole("button", {
          name: "Summarize session: Direct · Igor",
        }),
      ),
    ).toBe(false),
  );
});

it("tells when a change was refused and keeps the list as it was", async () => {
  stubSessionEndpoint((call) =>
    call.method === "POST" ? { ok: false, error: "notFound" } : answer(),
  );
  renderDialog();
  await sessionRows();
  fireEvent.click(
    screen.getByRole("button", { name: "Restart session: Direct · Igor" }),
  );
  expect((await screen.findByRole("alert")).textContent).toBe(
    "The agent or its session no longer exists.",
  );
  expect(await sessionRows()).toHaveLength(4);
});

it("closes with Cancel and with the close button", async () => {
  stubSessionEndpoint(() => answer());
  const { onClose } = renderDialog();
  await sessionRows();
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  expect(onClose).toHaveBeenCalledTimes(2);
});

it("words the popup in German", async () => {
  stubSessionEndpoint(() => answer());
  render(
    <I18nextProvider i18n={createI18n("de")}>
      <AgentSettingsDialog agentId="ed" onClose={vi.fn()} />
    </I18nextProvider>,
  );
  await screen.findByRole("table", { name: "Chat-Sitzungen von Ed" });
  expect(
    screen.getByRole("heading", { name: "Ed · Agent-Einstellungen" }),
  ).toBeTruthy();
  for (const name of [
    "Sitzungen",
    "Lagebuch",
    "Dreaming",
    "Lektionen & Rezepte",
  ]) {
    expect(screen.getByRole("tab", { name })).toBeTruthy();
  }
  expect(screen.getByText("Offene Sitzungen")).toBeTruthy();
  expect(screen.getByText("2 aktiv · 3 ruhen")).toBeTruthy();
  expect(screen.getByText("Token heute")).toBeTruthy();
  expect(screen.getByText("Neustart nötig")).toBeTruthy();
  expect(screen.getByText("Gruppe „Pages Team“")).toBeTruthy();
  expect(screen.getByLabelText("Ruhezustand nach")).toBeTruthy();
  expect(screen.getByLabelText("Automatischer Neustart ab")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Speichern" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Abbrechen" })).toBeTruthy();
});
