import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { afterEach, expect, it, vi } from "vitest";

import { AgentSettingsDialog } from "@/app/components/agent-settings/agent-settings-dialog";
import { createI18n } from "@/app/lib/i18n";
import { AGENT_DREAM_NO_COUNTS } from "@/definition/AgentDreaming";

import {
  dreamRun,
  dreamingOverview,
  lessonView,
  lessonsOverview,
  stubDreamingEndpoints,
} from "./agent-dreaming-fixture";

import type { ComponentProps } from "react";
import type {
  AgentDreamLogEntry,
  AgentDreamSchedule,
  AgentDreamingOverview,
  AgentDreamingResponse,
} from "@/definition/AgentDreaming";

const i18n = createI18n("en");

const CHEAP = {
  connectionId: "cheap-connection",
  model: "cheap-model",
  label: "Cheap Model",
};

function answer(
  overview: AgentDreamingOverview = dreamingOverview(),
  run?: "started" | "waiting",
): AgentDreamingResponse {
  return run === undefined
    ? { ok: true, overview }
    : { ok: true, overview, run };
}

function scheduleOf(
  overrides: Partial<AgentDreamSchedule>,
): AgentDreamingOverview {
  const base = dreamingOverview();
  return dreamingOverview({ schedule: { ...base.schedule, ...overrides } });
}

function renderDialog(
  props: Partial<ComponentProps<typeof AgentSettingsDialog>> = {},
  language = i18n,
): ReturnType<typeof render> {
  return render(
    <I18nextProvider i18n={language}>
      <AgentSettingsDialog
        agentId="ed"
        initialTab="dreaming"
        onClose={vi.fn()}
        {...props}
      />
    </I18nextProvider>,
  );
}

async function loaded(name = "Dreaming active"): Promise<HTMLElement> {
  return screen.findByRole("switch", { name });
}

async function choose(label: string, option: string): Promise<void> {
  fireEvent.keyDown(screen.getByRole("combobox", { name: label }), {
    key: "Enter",
  });
  fireEvent.click(await screen.findByRole("option", { name: option }));
}

function field(label: string): HTMLInputElement {
  const input = screen.getByLabelText(label);
  if (!(input instanceof HTMLInputElement))
    throw new Error(`${label} is no input`);
  return input;
}

function isOff(element: HTMLElement): boolean {
  return element.hasAttribute("disabled");
}

function saveButton(): HTMLElement {
  return screen.getByRole("button", { name: "Save" });
}

/** Lets the stubbed requests answer while the timers are fake; `findBy` cannot wait then. */
async function settle(milliseconds = 0): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(milliseconds);
  });
}

function card(title: string): HTMLElement {
  const section = screen
    .getByRole("heading", { name: title })
    .closest("section");
  if (section === null) throw new Error(`No card ${title}`);
  return section;
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it("opens in the tab Dreaming and reads the Dreaming of the agent with the cookies of the page", async () => {
  const { dreamingCalls } = stubDreamingEndpoints({ dreaming: () => answer() });
  renderDialog({ agentId: "ed/1" });
  await loaded();
  expect(dreamingCalls).toHaveLength(1);
  expect(dreamingCalls[0]?.url).toBe(
    "/chat-page-api/agent-dreaming?agentId=ed%2F1",
  );
  expect(dreamingCalls[0]?.method).toBe("GET");
  expect(dreamingCalls[0]?.headers.get("Accept")).toBe("application/json");
  expect(dreamingCalls[0]?.headers.get("X-Pages-Data-Request")).toBe("1");
  expect(
    screen.getByRole("tab", { name: "Dreaming" }).getAttribute("aria-selected"),
  ).toBe("true");
});

it("reads Dreaming only when its tab opens", async () => {
  const { dreamingCalls } = stubDreamingEndpoints({ dreaming: () => answer() });
  renderDialog({ initialTab: "sessions" });
  await screen.findByText("This agent has no sessions yet.");
  expect(dreamingCalls).toHaveLength(0);
  const tab = screen.getByRole("tab", { name: "Dreaming" });
  fireEvent.mouseDown(tab);
  fireEvent.click(tab);
  await loaded();
  expect(dreamingCalls).toHaveLength(1);
});

it("shows the schedule: switches, interval and unit, time, fill of the logbook, model and the schedule in words", async () => {
  stubDreamingEndpoints({ dreaming: () => answer() });
  renderDialog();
  const enabled = await loaded();
  expect(enabled.getAttribute("aria-checked")).toBe("true");
  expect(field("Interval").value).toBe("1");
  expect(screen.getByRole("combobox", { name: "Unit" }).textContent).toContain(
    "days",
  );
  expect(field("Time of day").value).toBe("");
  expect(
    screen.getByText("Without a time, Dreaming runs at the time of the instance (03:00)."),
  ).toBeTruthy();
  expect(screen.queryByRole("combobox", { name: "Weekday" })).toBeNull();
  expect(
    screen
      .getByRole("switch", { name: "When the logbook is full" })
      .getAttribute("aria-checked"),
  ).toBe("true");
  expect(screen.getByText("Logbook 62 % full, trigger from 80 %")).toBeTruthy();
  expect(
    screen.getByRole("combobox", { name: "Model for Dreaming" }).textContent,
  ).toContain("The agent's model (Claude Sonnet 5.5)");
  expect(screen.getByText("daily at 03:00 (instance time)")).toBeTruthy();
  expect(
    screen.getByText("In addition, as soon as the logbook is 80 % full."),
  ).toBeTruthy();
});

it("words the schedule of the entries as they change", async () => {
  stubDreamingEndpoints({ dreaming: () => answer() });
  renderDialog();
  await loaded();

  await choose("Unit", "hours");
  expect(screen.getByText("every 1 hour")).toBeTruthy();
  fireEvent.change(field("Interval"), { target: { value: "6" } });
  expect(screen.getByText("every 6 hours")).toBeTruthy();
  expect(screen.queryByLabelText("Time of day")).toBeNull();

  await choose("Unit", "days");
  fireEvent.change(field("Time of day"), { target: { value: "02:00" } });
  fireEvent.change(field("Interval"), { target: { value: "1" } });
  expect(screen.getByText("daily at 02:00")).toBeTruthy();
  fireEvent.change(field("Interval"), { target: { value: "30" } });
  expect(screen.getByText("every 30 days at 02:00")).toBeTruthy();

  fireEvent.change(field("Interval"), { target: { value: "7" } });
  expect(screen.getByText("every 7 days at 02:00")).toBeTruthy();
  await choose("Weekday", "Monday");
  expect(screen.getByText("every Monday at 02:00")).toBeTruthy();

  fireEvent.change(field("Interval"), { target: { value: "3" } });
  fireEvent.click(
    screen.getByRole("button", { name: "Use the time of the instance" }),
  );
  expect(screen.getByText("every 3 days at 03:00 (instance time)")).toBeTruthy();

  fireEvent.click(screen.getByRole("switch", { name: "Dreaming active" }));
  expect(
    screen.getByText("off – a run only starts with “Dream now”"),
  ).toBeTruthy();
  fireEvent.change(field("Interval"), { target: { value: "0" } });
  expect(screen.getByText("not valid yet")).toBeTruthy();
});

it("offers a weekday only at an interval of 7 days", async () => {
  stubDreamingEndpoints({ dreaming: () => answer() });
  renderDialog();
  await loaded();
  fireEvent.change(field("Interval"), { target: { value: "6" } });
  expect(screen.queryByRole("combobox", { name: "Weekday" })).toBeNull();
  fireEvent.change(field("Interval"), { target: { value: "7" } });
  const weekday = screen.getByRole("combobox", { name: "Weekday" });
  expect(weekday.textContent).toContain("No weekday");
  await choose("Weekday", "Sunday");
  expect(weekday.textContent).toContain("Sunday");
  await choose("Unit", "hours");
  expect(screen.queryByRole("combobox", { name: "Weekday" })).toBeNull();
});

it("keeps the interval inside the range of the unit when the unit changes", async () => {
  stubDreamingEndpoints({
    dreaming: () => answer(scheduleOf({ unit: "hours", interval: 720 })),
  });
  renderDialog();
  await loaded();
  expect(field("Interval").value).toBe("720");
  await choose("Unit", "days");
  expect(field("Interval").value).toBe("30");
  await choose("Unit", "hours");
  expect(field("Interval").value).toBe("30");
});

it("saves an interval in hours without time and weekday and with the model of the agent", async () => {
  const saved = scheduleOf({ unit: "hours", interval: 6 });
  const { dreamingCalls } = stubDreamingEndpoints({
    dreaming: (call) => (call.method === "POST" ? answer(saved) : answer()),
  });
  renderDialog();
  await loaded();
  expect(isOff(saveButton())).toBe(true);
  await choose("Unit", "hours");
  fireEvent.change(field("Interval"), { target: { value: "6" } });
  expect(isOff(saveButton())).toBe(false);
  fireEvent.click(saveButton());
  expect(await screen.findByText("Schedule saved.")).toBeTruthy();
  expect(dreamingCalls).toHaveLength(2);
  expect(dreamingCalls[1]?.method).toBe("POST");
  expect(dreamingCalls[1]?.url).toBe("/chat-page-api/agent-dreaming");
  expect(dreamingCalls[1]?.fields).toEqual({
    intent: "save-settings",
    agentId: "ed",
    enabled: "true",
    interval: "6",
    unit: "hours",
    time: "",
    weekday: "",
    onFullLogbook: "true",
    modelConnectionId: "",
    model: "",
  });
  // The entries show what the server saved and nothing is left to save.
  expect(field("Interval").value).toBe("6");
  expect(isOff(saveButton())).toBe(true);
});

it("sends the time and, at 7 days, the weekday and the chosen model", async () => {
  const { dreamingCalls } = stubDreamingEndpoints({
    dreaming: () => answer(dreamingOverview({ models: [CHEAP] })),
  });
  renderDialog();
  await loaded();
  fireEvent.change(field("Interval"), { target: { value: "7" } });
  fireEvent.change(field("Time of day"), { target: { value: "02:00" } });
  await choose("Weekday", "Monday");
  await choose("Model for Dreaming", "Cheap Model");
  fireEvent.click(screen.getByRole("switch", { name: "When the logbook is full" }));
  fireEvent.click(saveButton());
  await vi.waitFor(() => expect(dreamingCalls).toHaveLength(2));
  expect(dreamingCalls[1]?.fields).toEqual({
    intent: "save-settings",
    agentId: "ed",
    enabled: "true",
    interval: "7",
    unit: "days",
    time: "02:00",
    weekday: "1",
    onFullLogbook: "false",
    modelConnectionId: "cheap-connection",
    model: "cheap-model",
  });
});

it("sends no weekday when the interval is not 7 days, and the schedule off", async () => {
  const { dreamingCalls } = stubDreamingEndpoints({
    dreaming: () => answer(),
  });
  renderDialog();
  await loaded();
  fireEvent.change(field("Interval"), { target: { value: "7" } });
  await choose("Weekday", "Friday");
  fireEvent.change(field("Time of day"), { target: { value: "02:30" } });
  fireEvent.change(field("Interval"), { target: { value: "6" } });
  fireEvent.click(screen.getByRole("switch", { name: "Dreaming active" }));
  fireEvent.click(saveButton());
  await vi.waitFor(() => expect(dreamingCalls).toHaveLength(2));
  expect(dreamingCalls[1]?.fields).toMatchObject({
    enabled: "false",
    interval: "6",
    unit: "days",
    time: "02:30",
    weekday: "",
  });
});

it("keeps the saved model visible when the choice no longer lists it", async () => {
  stubDreamingEndpoints({
    dreaming: () =>
      answer(
        dreamingOverview({
          model: { connectionId: "gone", model: "gone-model" },
          models: [CHEAP],
        }),
      ),
  });
  renderDialog();
  await loaded();
  expect(
    screen.getByRole("combobox", { name: "Model for Dreaming" }).textContent,
  ).toContain("gone-model");
});

it("checks the interval against the range of its unit before it sends anything", async () => {
  const { dreamingCalls } = stubDreamingEndpoints({ dreaming: () => answer() });
  renderDialog();
  await loaded();
  fireEvent.change(field("Interval"), { target: { value: "31" } });
  expect(screen.getByRole("alert").textContent).toBe(
    "Enter a whole number from 1 to 30.",
  );
  expect(isOff(saveButton())).toBe(true);
  fireEvent.change(field("Interval"), { target: { value: "2.5" } });
  expect(isOff(saveButton())).toBe(true);
  await choose("Unit", "hours");
  fireEvent.change(field("Interval"), { target: { value: "721" } });
  expect(screen.getByRole("alert").textContent).toBe(
    "Enter a whole number from 1 to 720.",
  );
  fireEvent.change(field("Interval"), { target: { value: "720" } });
  expect(screen.queryByRole("alert")).toBeNull();
  expect(isOff(saveButton())).toBe(false);
  expect(dreamingCalls).toHaveLength(1);
});

it("says why saving was refused and keeps the entries", async () => {
  stubDreamingEndpoints({
    dreaming: (call) =>
      call.method === "POST" ? { ok: false, error: "forbidden" } : answer(),
  });
  renderDialog();
  await loaded();
  fireEvent.change(field("Interval"), { target: { value: "3" } });
  fireEvent.click(saveButton());
  expect((await screen.findByRole("alert")).textContent).toBe(
    "You are not allowed to do that.",
  );
  expect(field("Interval").value).toBe("3");
  expect(isOff(saveButton())).toBe(false);
});

it("reports an unreachable endpoint and an unreadable answer as unavailable", async () => {
  stubDreamingEndpoints({
    dreaming: (call) =>
      call.method === "POST"
        ? Response.json({ nonsense: true }, { status: 500 })
        : answer(),
  });
  renderDialog();
  await loaded();
  fireEvent.change(field("Interval"), { target: { value: "3" } });
  fireEvent.click(saveButton());
  expect((await screen.findByRole("alert")).textContent).toBe(
    "Dreaming is not reachable right now. Try again in a moment.",
  );
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.stubGlobal("fetch", () => Promise.reject(new TypeError("offline")));
  fireEvent.change(field("Interval"), { target: { value: "4" } });
  fireEvent.click(saveButton());
  await vi.waitFor(() =>
    expect(screen.getByRole("alert").textContent).toContain("not reachable"),
  );
});

it("maps the status of a refusal without an answer body to its reason", async () => {
  stubDreamingEndpoints({
    dreaming: (call) =>
      call.method === "POST"
        ? new Response("busy", { status: 409 })
        : answer(),
  });
  renderDialog();
  await loaded();
  fireEvent.change(field("Interval"), { target: { value: "3" } });
  fireEvent.click(saveButton());
  expect((await screen.findByRole("alert")).textContent).toBe(
    "Dreaming is already running or the state has changed meanwhile. Try again in a moment.",
  );
});

it("starts a run with Dream now and shows that it dreams", async () => {
  const { dreamingCalls } = stubDreamingEndpoints({
    dreaming: (call) =>
      call.method === "POST"
        ? answer(dreamingOverview({ isRunning: true }), "started")
        : answer(),
  });
  renderDialog();
  await loaded();
  fireEvent.click(screen.getByRole("button", { name: "Dream now" }));
  const running = await screen.findByRole("button", { name: "Dreaming …" });
  expect(isOff(running)).toBe(true);
  expect(dreamingCalls[1]?.method).toBe("POST");
  expect(dreamingCalls[1]?.fields).toEqual({
    intent: "run-now",
    agentId: "ed",
  });
  expect(within(card("Next run")).getByText("running now")).toBeTruthy();
  expect(screen.getByText("The run was started.")).toBeTruthy();
});

it("tells that the run waits while the agent works in a chat", async () => {
  stubDreamingEndpoints({
    dreaming: (call) =>
      call.method === "POST"
        ? answer(dreamingOverview({ isWaiting: true }), "waiting")
        : answer(),
  });
  renderDialog();
  await loaded();
  fireEvent.click(screen.getByRole("button", { name: "Dream now" }));
  expect(
    await screen.findByText(
      "The agent is working in a chat right now; Dreaming starts in the next quiet moment.",
    ),
  ).toBeTruthy();
  expect(
    within(card("Next run")).getByText("due – waiting for a quiet moment"),
  ).toBeTruthy();
  expect(isOff(screen.getByRole("button", { name: "Waiting …" }))).toBe(true);
});

it("says why a run could not be started", async () => {
  stubDreamingEndpoints({
    dreaming: (call) =>
      call.method === "POST" ? { ok: false, error: "conflict" } : answer(),
  });
  renderDialog();
  await loaded();
  fireEvent.click(screen.getByRole("button", { name: "Dream now" }));
  expect((await screen.findByRole("alert")).textContent).toContain(
    "Dreaming is already running",
  );
  expect(
    isOff(screen.getByRole("button", { name: "Dream now" })),
  ).toBe(false);
});

it("reads Dreaming again every 4 seconds while a run goes on, until it ends", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  let isRunning = true;
  const { dreamingCalls } = stubDreamingEndpoints({
    dreaming: () =>
      answer(
        dreamingOverview({
          isRunning,
          lastRun: isRunning ? null : dreamRun({ trigger: "manual" }),
        }),
      ),
  });
  renderDialog();
  await settle();
  expect(isOff(screen.getByRole("button", { name: "Dreaming …" }))).toBe(true);
  expect(dreamingCalls).toHaveLength(1);

  await settle(3_999);
  expect(dreamingCalls).toHaveLength(1);
  await settle(1);
  expect(dreamingCalls).toHaveLength(2);
  expect(dreamingCalls[1]?.method).toBe("GET");

  isRunning = false;
  await settle(4_000);
  expect(dreamingCalls).toHaveLength(3);
  expect(screen.getByRole("button", { name: "Dream now" })).toBeTruthy();
  expect(screen.getByText("Started by: By hand")).toBeTruthy();

  await settle(30_000);
  expect(dreamingCalls).toHaveLength(3);
});

it("also reads again while a run is due and waits for a quiet moment", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const { dreamingCalls } = stubDreamingEndpoints({
    dreaming: () => answer(dreamingOverview({ isWaiting: true })),
  });
  renderDialog();
  await settle();
  expect(screen.getByRole("button", { name: "Waiting …" })).toBeTruthy();
  await settle(4_000);
  expect(dreamingCalls).toHaveLength(2);
});

it("does not read again while nothing runs, and stops with the tab", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const idle = stubDreamingEndpoints({ dreaming: () => answer() });
  const first = renderDialog();
  await settle();
  expect(screen.getByRole("switch", { name: "Dreaming active" })).toBeTruthy();
  await settle(20_000);
  expect(idle.dreamingCalls).toHaveLength(1);
  first.unmount();

  const busy = stubDreamingEndpoints({
    dreaming: () => answer(dreamingOverview({ isRunning: true })),
  });
  const second = renderDialog();
  await settle();
  expect(screen.getByRole("button", { name: "Dreaming …" })).toBeTruthy();
  second.unmount();
  await settle(20_000);
  expect(busy.dreamingCalls).toHaveLength(1);
});

it("keeps what is being edited while a poll brings a new overview", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const { dreamingCalls } = stubDreamingEndpoints({
    dreaming: () => answer(dreamingOverview({ isRunning: true })),
  });
  renderDialog();
  await settle();
  fireEvent.change(field("Interval"), { target: { value: "5" } });
  await settle(4_000);
  expect(dreamingCalls).toHaveLength(2);
  expect(field("Interval").value).toBe("5");
});

it("shows the controls to a viewer who may not change Dreaming as off, without log and files", async () => {
  stubDreamingEndpoints({
    dreaming: () =>
      answer(
        dreamingOverview({
          canChange: false,
          files: null,
          lastRun: dreamRun(),
        }),
      ),
  });
  renderDialog();
  const enabled = await loaded();
  expect(isOff(enabled)).toBe(true);
  expect(isOff(field("Interval"))).toBe(true);
  expect(isOff(screen.getByRole("combobox", { name: "Unit" }))).toBe(true);
  expect(isOff(field("Time of day"))).toBe(true);
  expect(
    isOff(screen.getByRole("combobox", { name: "Model for Dreaming" })),
  ).toBe(true);
  expect(
    isOff(screen.getByRole("switch", { name: "When the logbook is full" })),
  ).toBe(true);
  expect(screen.getByText("Only administrators change Dreaming.")).toBeTruthy();
  expect(isOff(saveButton())).toBe(true);
  expect(isOff(screen.getByRole("button", { name: "Dream now" }))).toBe(true);
  expect(screen.queryByRole("heading", { name: "Log of the last run" })).toBeNull();
  expect(screen.queryByRole("heading", { name: "Files" })).toBeNull();
  // What happened is still there to read.
  expect(within(card("Last run")).getByText("Updated")).toBeTruthy();
  expect(screen.getByRole("heading", { name: "Next run" })).toBeTruthy();
});

it("shows when the last run ended, its result, its trigger and what it changed", async () => {
  stubDreamingEndpoints({
    dreaming: () => answer(dreamingOverview({ lastRun: dreamRun() })),
  });
  renderDialog();
  await loaded();
  const lastRun = card("Last run");
  expect(within(lastRun).getByText(/13\.11\.2026/u)).toBeTruthy();
  expect(within(lastRun).getByText("Updated")).toBeTruthy();
  expect(within(lastRun).getByText("Started by: Schedule")).toBeTruthy();
  expect(
    within(lastRun).getByText(
      "3 entries taken into memory · 1 entry dropped · 1 new lesson",
    ),
  ).toBeTruthy();
});

it.each([
  ["unchanged", "Unchanged", "logbook", "Started by: Logbook full"],
  ["failed", "Failed", "manual", "Started by: By hand"],
] as const)(
  "words a run that ended %s with its badge and trigger",
  async (status, badge, trigger, line) => {
    stubDreamingEndpoints({
      dreaming: () =>
        answer(
          dreamingOverview({
            lastRun: dreamRun({
              status,
              trigger,
              counts: AGENT_DREAM_NO_COUNTS,
            }),
          }),
        ),
    });
    renderDialog();
    await loaded();
    const lastRun = card("Last run");
    expect(within(lastRun).getByText(badge)).toBeTruthy();
    expect(within(lastRun).getByText(line)).toBeTruthy();
    expect(within(lastRun).getByText("Nothing changed.")).toBeTruthy();
  },
);

it("explains the error code of a failed run, and shows an unknown code as it is", async () => {
  stubDreamingEndpoints({
    dreaming: () =>
      answer(
        dreamingOverview({
          lastRun: dreamRun({ status: "failed", errorCode: "invalidAnswer" }),
        }),
      ),
  });
  const first = renderDialog();
  await loaded();
  expect(
    within(card("Last run")).getByText("The model gave no usable answer."),
  ).toBeTruthy();
  first.unmount();

  stubDreamingEndpoints({
    dreaming: () =>
      answer(
        dreamingOverview({
          lastRun: dreamRun({ status: "failed", errorCode: "model_gone" }),
        }),
      ),
  });
  renderDialog();
  await loaded();
  expect(
    within(card("Last run")).getByText(
      "The run failed (error code model_gone). Details are in the server log.",
    ),
  ).toBeTruthy();
});

it("says that no run happened yet", async () => {
  stubDreamingEndpoints({ dreaming: () => answer() });
  renderDialog();
  await loaded();
  expect(within(card("Last run")).getByText("There has been no run yet.")).toBeTruthy();
  expect(
    within(card("Log of the last run")).getByText(
      "The log appears after the first run.",
    ),
  ).toBeTruthy();
});

it("words when the next run is due, that it is off, waits or runs", async () => {
  stubDreamingEndpoints({ dreaming: () => answer() });
  const due = renderDialog();
  await loaded();
  expect(within(card("Next run")).getByText(/14\.11\.2026/u)).toBeTruthy();
  due.unmount();

  stubDreamingEndpoints({
    dreaming: () =>
      answer(
        dreamingOverview({
          schedule: { ...dreamingOverview().schedule, isEnabled: false },
          nextRunAt: null,
        }),
      ),
  });
  const off = renderDialog();
  await loaded();
  expect(within(card("Next run")).getByText("off")).toBeTruthy();
  expect(
    within(card("Next run")).getByText(
      "Dreaming is off; a run only starts by hand.",
    ),
  ).toBeTruthy();
  off.unmount();

  stubDreamingEndpoints({
    dreaming: () => answer(dreamingOverview({ isWaiting: true })),
  });
  const waiting = renderDialog();
  await loaded();
  expect(
    within(card("Next run")).getByText("due – waiting for a quiet moment"),
  ).toBeTruthy();
  waiting.unmount();
});

const LOG: readonly AgentDreamLogEntry[] = [
  { kind: "recipeCreated", text: "ticket_status" },
  { kind: "memoryTaken", text: "Igor prefers short answers." },
  { kind: "memoryTaken", text: "PAGE-370 belongs to Ed." },
  { kind: "memoryDropped", text: "PAGE-360 is done." },
  { kind: "lessonLearned", text: "Read the ticket first." },
  { kind: "lessonStrengthened", text: "Ask only when the ticket is silent." },
  { kind: "lessonDropped", text: "Always greet first." },
  { kind: "recipeUpdated", text: "release_notes got a keyword" },
  { kind: "recipeDropped", text: "old_flow" },
];

it("groups the log of the last run by kind in a fixed order", async () => {
  stubDreamingEndpoints({
    dreaming: () => answer(dreamingOverview({ lastRun: dreamRun({ log: LOG }) })),
  });
  renderDialog();
  await loaded();
  const log = card("Log of the last run");
  const headings = within(log)
    .getAllByRole("heading", { level: 4 })
    .map((heading) => heading.textContent);
  expect(headings).toEqual([
    "Taken into memory (2)",
    "Dropped (done/outdated) (1)",
    "New lesson (1)",
    "Lesson confirmed (1)",
    "Lesson dropped (1)",
    "Recipe created (1)",
    "Recipe updated (1)",
    "Recipe removed (1)",
  ]);
  const memory = within(log)
    .getByRole("heading", { name: "Taken into memory (2)" })
    .closest("section");
  expect(memory).not.toBeNull();
  expect(within(memory as HTMLElement).getAllByRole("listitem")).toHaveLength(2);
  expect(within(log).getByText("Igor prefers short answers.")).toBeTruthy();
  expect(within(log).getByText("old_flow")).toBeTruthy();
});

it("shows only the kinds a run touched and says when it touched none", async () => {
  stubDreamingEndpoints({
    dreaming: () =>
      answer(
        dreamingOverview({
          lastRun: dreamRun({
            log: [{ kind: "lessonLearned", text: "Read the ticket first." }],
          }),
        }),
      ),
  });
  const first = renderDialog();
  await loaded();
  const log = card("Log of the last run");
  expect(within(log).getAllByRole("heading", { level: 4 })).toHaveLength(1);
  first.unmount();

  stubDreamingEndpoints({
    dreaming: () => answer(dreamingOverview({ lastRun: dreamRun({ log: [] }) })),
  });
  renderDialog();
  await loaded();
  expect(
    within(card("Log of the last run")).getByText(
      "The last run changed nothing.",
    ),
  ).toBeTruthy();
});

it("shows MEMORY.md and DREAM.md with their sizes against the limits", async () => {
  stubDreamingEndpoints({ dreaming: () => answer() });
  renderDialog();
  await loaded();
  const files = card("Files");
  expect(within(files).getByText("MEMORY.md")).toBeTruthy();
  expect(within(files).getByText("1,234 / 8,000 characters")).toBeTruthy();
  expect(within(files).getByText("DREAM.md")).toBeTruthy();
  expect(
    within(files).getByText("2,100 / 4,000 characters · 12 lessons"),
  ).toBeTruthy();
  expect(
    within(files)
      .getByRole("meter", { name: "Fill level of MEMORY.md" })
      .getAttribute("aria-valuenow"),
  ).toBe("15");
  expect(
    within(files)
      .getByRole("meter", { name: "Fill level of DREAM.md" })
      .getAttribute("aria-valuenow"),
  ).toBe("53");
  expect(
    within(files).getByText(/edited under Settings → Agents → Memory/u),
  ).toBeTruthy();
});

it("shows the text of both files read-only in a collapsible viewer", async () => {
  stubDreamingEndpoints({ dreaming: () => answer() });
  renderDialog();
  await loaded();
  const files = card("Files");
  const memory = within(files).getByLabelText("Content of MEMORY.md");
  expect(memory.tagName).toBe("PRE");
  expect(memory.textContent).toBe("# Memory\n- Igor prefers short answers.\n");
  expect(within(files).getByLabelText("Content of DREAM.md").textContent).toBe(
    "# Lessons\n- Read the ticket first.\n",
  );
  const details = within(files).getByText("Show MEMORY.md").closest("details");
  expect(details?.open).toBe(false);
  fireEvent.click(within(files).getByText("Show MEMORY.md"));
  expect(details?.open).toBe(true);
});

it("says that a file is empty and leaves out the viewers when the viewer may not read the files", async () => {
  stubDreamingEndpoints({
    dreaming: () =>
      answer(dreamingOverview({ files: { memory: "", dream: "x" } })),
  });
  const first = renderDialog();
  await loaded();
  expect(within(card("Files")).getByText("The file is empty.")).toBeTruthy();
  first.unmount();

  stubDreamingEndpoints({ dreaming: () => answer(dreamingOverview({ files: null })) });
  renderDialog();
  await loaded();
  const files = card("Files");
  expect(within(files).getByText("1,234 / 8,000 characters")).toBeTruthy();
  expect(within(files).queryByText("Show MEMORY.md")).toBeNull();
  expect(within(files).queryByText("Show DREAM.md")).toBeNull();
});

it("switches to the tab Lessons & recipes from the files card", async () => {
  const { lessonsCalls } = stubDreamingEndpoints({
    dreaming: () => answer(),
    lessons: () => ({
      ok: true,
      overview: lessonsOverview({ lessons: [lessonView("l1")] }),
    }),
  });
  renderDialog();
  await loaded();
  fireEvent.click(screen.getByRole("button", { name: "Edit lessons" }));
  expect(
    await screen.findByText("Read the ticket before you ask questions."),
  ).toBeTruthy();
  expect(
    screen
      .getByRole("tab", { name: "Lessons & recipes" })
      .getAttribute("aria-selected"),
  ).toBe("true");
  expect(lessonsCalls[0]?.url).toBe("/chat-page-api/agent-lessons?agentId=ed");
});

it("shows a hint while Dreaming loads and why it could not be read, with a way to try again", async () => {
  let isFailing = true;
  stubDreamingEndpoints({
    dreaming: () =>
      isFailing ? { ok: false, error: "unavailable" } : answer(),
  });
  renderDialog();
  expect(screen.getByText("Loading Dreaming …")).toBeTruthy();
  expect((await screen.findByRole("alert")).textContent).toBe(
    "Dreaming is not reachable right now. Try again in a moment.",
  );
  isFailing = false;
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  await loaded();
});

it("closes the popup with Cancel", async () => {
  stubDreamingEndpoints({ dreaming: () => answer() });
  const onClose = vi.fn();
  renderDialog({ onClose });
  await loaded();
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(onClose).toHaveBeenCalledTimes(1);
});

it("words the tab in German", async () => {
  stubDreamingEndpoints({
    dreaming: () =>
      answer(
        dreamingOverview({
          lastRun: dreamRun({ log: LOG }),
          models: [CHEAP],
        }),
      ),
  });
  renderDialog({}, createI18n("de"));
  await loaded("Dreaming aktiv");
  expect(screen.getByRole("heading", { name: "Zeitplan" })).toBeTruthy();
  expect(screen.getByLabelText("Intervall")).toBeTruthy();
  expect(screen.getByLabelText("Uhrzeit")).toBeTruthy();
  expect(screen.getByText("täglich um 03:00 (Zeit der Instanz)")).toBeTruthy();
  expect(screen.getByText("Lagebuch zu 62 % gefüllt, Anstoß ab 80 %")).toBeTruthy();
  expect(screen.getByRole("combobox", { name: "Modell für Dreaming" }).textContent).toContain(
    "Modell des Agents (Claude Sonnet 5.5)",
  );
  expect(screen.getByRole("switch", { name: "Bei vollem Lagebuch" })).toBeTruthy();
  expect(screen.getByRole("heading", { name: "Letzter Lauf" })).toBeTruthy();
  expect(screen.getByRole("heading", { name: "Nächster Lauf" })).toBeTruthy();
  expect(screen.getByText("Ausgelöst durch: Zeitplan")).toBeTruthy();
  expect(
    screen.getByText("3 Einträge übernommen · 1 Eintrag verworfen · 1 neue Lektion"),
  ).toBeTruthy();
  expect(screen.getByRole("heading", { name: "Protokoll des letzten Laufs" })).toBeTruthy();
  expect(screen.getByRole("heading", { name: "Ins Gedächtnis übernommen (2)" })).toBeTruthy();
  expect(screen.getByRole("heading", { name: "Verworfen (erledigt/veraltet) (1)" })).toBeTruthy();
  expect(screen.getByText("1.234 / 8.000 Zeichen")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Jetzt träumen" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Speichern" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Lektionen bearbeiten" })).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Intervall"), { target: { value: "7" } });
  fireEvent.keyDown(screen.getByRole("combobox", { name: "Wochentag" }), {
    key: "Enter",
  });
  fireEvent.click(await screen.findByRole("option", { name: "Montag" }));
  expect(screen.getByText("jeden Montag um 03:00 (Zeit der Instanz)")).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Intervall"), { target: { value: "6" } });
  expect(screen.getByText("alle 6 Tage um 03:00 (Zeit der Instanz)")).toBeTruthy();
});
