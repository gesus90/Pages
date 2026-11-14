import { fireEvent, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import {
  dreamRun,
  dreamingOverview,
  stubDreamingEndpoints,
} from "./agent-dreaming-fixture";
import {
  CHEAP,
  answer,
  card,
  choose,
  field,
  isOff,
  loaded,
  renderDialog,
  saveButton,
  scheduleOf,
  settle,
} from "./agent-dreaming-tab-fixture";

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
    screen.getByText(
      "Without a time, Dreaming runs at the time of the instance (03:00).",
    ),
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
  expect(
    screen.getByText("every 3 days at 03:00 (instance time)"),
  ).toBeTruthy();

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
  fireEvent.click(
    screen.getByRole("switch", { name: "When the logbook is full" }),
  );
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
      call.method === "POST" ? new Response("busy", { status: 409 }) : answer(),
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
  expect(isOff(screen.getByRole("button", { name: "Dream now" }))).toBe(false);
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
