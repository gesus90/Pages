import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { afterEach, expect, it, vi } from "vitest";

import { PlanRunView } from "@/app/components/agents/plans/plan-run-view";
import { createI18n } from "@/app/lib/i18n";

import { runStep, syntheticRun, syntheticSession } from "./page72-run-fixture";

import type { AgentPlanRun } from "@/definition/AgentPlan";
import type { RenderResult } from "@testing-library/react";

const i18n = createI18n("de");

afterEach(() => vi.useRealTimers());

function view(run: AgentPlanRun | null, onStop = vi.fn()): React.ReactElement {
  return (
    <I18nextProvider i18n={i18n}>
      <PlanRunView
        state={{
          run,
          runs: run ? [run] : [],
          selectedId: run?.id ?? "",
          select: vi.fn(),
          error: null,
        }}
        isPending={false}
        onStop={onStop}
      />
    </I18nextProvider>
  );
}

function renderRun(run = syntheticRun()): RenderResult {
  return render(view(run));
}

function details(name = "Implementation"): HTMLElement {
  return screen.getByRole("region", {
    name: i18n.t("plans.details.title", { name }),
  });
}

function selectAgent(name: string): void {
  fireEvent.click(
    within(
      screen.getByRole("list", { name: i18n.t("plans.sequence") }),
    ).getByRole("button", { name: new RegExp(name) }),
  );
}

it("renders only three selectable agents between compact checkpoints and counts successful agents", () => {
  renderRun();
  const sequence = screen.getByRole("list", { name: i18n.t("plans.sequence") });
  expect(within(sequence).getAllByRole("listitem")).toHaveLength(5);
  const agents = within(sequence).getAllByRole("button");
  expect(agents).toHaveLength(3);
  expect(agents.map((button) => button.textContent)).toEqual([
    "1. ResearchErfolgreich",
    "2. ImplementationLäuft",
    "3. ReviewWartet",
  ]);
  expect(agents[1]?.getAttribute("aria-pressed")).toBe("true");
  const progress = screen.getByRole("progressbar", {
    name: i18n.t("plans.progress"),
  });
  expect(progress.getAttribute("value")).toBe("1");
  expect(progress.getAttribute("max")).toBe("3");
  expect(agents[0]?.className).toContain("text-success");
  expect(agents[1]?.className).toContain("text-status-active");
  expect(agents[2]?.className).toContain("text-muted-foreground");
});

it("shows selected agent facts, summary, three TODO states and sanitized logs below the sequence", () => {
  renderRun();
  const detail = details();
  for (const text of [
    "Implementation",
    "12.0 s",
    "synthetic-model",
    "/synthetic/workspace",
    "Synthetic progress summary",
  ])
    expect(within(detail).getAllByText(text).length).toBeGreaterThan(0);
  const todos = within(
    within(detail).getByRole("region", { name: i18n.t("plans.session.todos") }),
  ).getAllByRole("listitem");
  expect(todos[0]?.textContent).toContain("erledigt");
  expect(todos[0]?.className).toContain("text-success");
  expect(todos[1]?.textContent).toContain("läuft");
  expect(todos[1]?.className).toContain("text-status-active");
  expect(todos[2]?.textContent).toContain("wartet");
  expect(todos[2]?.className).toContain("text-muted-foreground");
  expect(
    within(detail).getByText(i18n.t("plans.details.todoHint")),
  ).toBeDefined();
  expect(within(detail).getByRole("log").textContent).toContain(
    "Reading requirements",
  );
  selectAgent("Review");
  expect(
    screen.queryByRole("region", {
      name: i18n.t("plans.details.title", { name: "Implementation" }),
    }),
  ).toBeNull();
  expect(
    within(details("Review")).getByRole("button", {
      name: i18n.t("plans.session.prompt"),
    }),
  ).toHaveProperty("disabled", true);
});

it("keeps selection during polling, updates events and resets selection when history switches runs", () => {
  const run = syntheticRun();
  const mounted = renderRun(run);
  selectAgent("Research");
  const session = { ...syntheticSession(), events: ["Updated event"] };
  const updated = {
    ...run,
    steps: run.steps.map((step) =>
      step.id === "Research" ? { ...step, session } : step,
    ),
  };
  mounted.rerender(view(updated));
  expect(within(details("Research")).getByRole("log").textContent).toBe(
    "Updated event",
  );
  mounted.rerender(view({ ...updated, id: "older-run" }));
  expect(details()).toBeDefined();
});

it("shows failures, cancellation and blocked successors without counting them as completed", () => {
  const run = syntheticRun();
  renderRun({
    ...run,
    status: "failed",
    steps: [
      runStep("start", { status: "succeeded" }),
      runStep("Failed agent", {
        status: "failed",
        error: "plan_dependency_failed",
        cancellation: "confirmed",
      }),
      runStep("Blocked agent", { isBlocked: true }),
      runStep("end"),
    ],
  });
  const agents = within(
    screen.getByRole("list", { name: i18n.t("plans.sequence") }),
  ).getAllByRole("button");
  expect(agents[0]?.className).toContain("text-destructive");
  expect(within(details("Failed agent")).getByRole("alert")).toBeDefined();
  expect(
    within(details("Failed agent")).getByText(
      i18n.t("plans.cancellation.confirmed"),
    ),
  ).toBeDefined();
  selectAgent("Blocked agent");
  expect(
    within(details("Blocked agent")).getByText(i18n.t("plans.blocked")),
  ).toBeDefined();
  expect(screen.getByRole("progressbar").getAttribute("value")).toBe("0");
});

it("shows internal group agents once and retains their recorded order without the group summary", () => {
  const run = syntheticRun();
  renderRun({
    ...run,
    steps: [
      runStep("start"),
      runStep("A", { groupId: "group" }),
      runStep("B", { groupId: "group" }),
      runStep("end"),
      runStep("group", { name: "Group summary" }),
    ],
  });
  const sequence = screen.getByRole("list", { name: i18n.t("plans.sequence") });
  expect(
    within(sequence)
      .getAllByRole("button")
      .map((button) => button.textContent),
  ).toEqual(["1. AWartet", "2. BWartet"]);
  expect(within(sequence).queryByText("Group summary")).toBeNull();
  expect(
    within(details("A")).getByText(
      i18n.t("plans.groups.step", { name: "Group summary", index: 1 }),
    ),
  ).toBeDefined();
});

it("does not turn open or unreported TODOs green when the runner succeeds", () => {
  const run = syntheticRun();
  const session = syntheticSession();
  renderRun({
    ...run,
    status: "succeeded",
    steps: [
      runStep("Agent", {
        status: "succeeded",
        session: { ...session, acceptance: null },
      }),
    ],
  });
  const todos = within(
    screen.getByRole("region", { name: i18n.t("plans.session.todos") }),
  ).getAllByRole("listitem");
  expect(
    todos.every((todo) =>
      todo.textContent?.includes(i18n.t("plans.session.unknown")),
    ),
  ).toBe(true);
  expect(todos.every((todo) => !todo.className.includes("text-success"))).toBe(
    true,
  );
});

it("loads the historical assignment only on demand and retries a failed request", async () => {
  const request = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValueOnce(new Response(null, { status: 403 }))
    .mockResolvedValueOnce(
      new Response("Synthetic resolved inputs", {
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      }),
    );
  renderRun();
  expect(request).not.toHaveBeenCalled();
  fireEvent.click(
    within(details()).getByRole("button", {
      name: i18n.t("plans.session.prompt"),
    }),
  );
  await screen.findByRole("alert");
  expect(request.mock.calls[0]?.[0]).toBe(
    "/agent-api/plan-runs/synthetic-run/steps/Implementation/prompt",
  );
  fireEvent.click(
    screen.getByRole("button", { name: i18n.t("plans.details.retryInputs") }),
  );
  expect(await screen.findByText("Synthetic resolved inputs")).toBeDefined();
});

it("aborts an input request on selection change and does not reveal its late response", async () => {
  let resolvePrompt: (response: Response) => void = () => {
    throw new Error("Request not started");
  };
  const request = vi.spyOn(globalThis, "fetch").mockImplementation(
    () =>
      new Promise<Response>((resolve) => {
        resolvePrompt = resolve;
      }),
  );
  renderRun();
  fireEvent.click(
    within(details()).getByRole("button", {
      name: i18n.t("plans.session.prompt"),
    }),
  );
  await waitFor(() => expect(request).toHaveBeenCalledOnce());
  const signal = request.mock.calls[0]?.[1]?.signal;
  selectAgent("Review");
  expect(signal?.aborted).toBe(true);
  await act(async () =>
    resolvePrompt(
      new Response("Stale input", {
        headers: { "Content-Type": "text/plain" },
      }),
    ),
  );
  expect(screen.queryByText("Stale input")).toBeNull();
});

it("updates a running duration and clears its timer on unmount", () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-15T10:00:20.000Z"));
  const run = syntheticRun();
  const session = { ...syntheticSession(), endedAt: null, turnEndedAt: null };
  const mounted = renderRun({
    ...run,
    steps: [runStep("Agent", { status: "running", session })],
  });
  act(() => {
    vi.advanceTimersByTime(1000);
  });
  expect(within(details("Agent")).getByText("21.0 s")).toBeDefined();
  mounted.unmount();
  expect(vi.getTimerCount()).toBe(0);
});

it("preserves stopping and an explicit empty history state", () => {
  const onStop = vi.fn();
  const mounted = render(view(syntheticRun(), onStop));
  fireEvent.click(screen.getByRole("button", { name: i18n.t("plans.stop") }));
  expect(onStop).toHaveBeenCalledWith("synthetic-run");
  mounted.rerender(view(null));
  expect(screen.getByText(i18n.t("plans.noRuns"))).toBeDefined();
  expect(
    screen.queryByRole("list", { name: i18n.t("plans.sequence") }),
  ).toBeNull();
});

it("keeps a failed checkpoint's error and cancellation visible outside the agent-only sequence", () => {
  const run = syntheticRun();
  renderRun({
    ...run,
    status: "failed",
    steps: [
      runStep("start", {
        status: "failed",
        error: "plan_dependency_failed",
        cancellation: "confirmed",
      }),
      runStep("Agent"),
      runStep("end"),
    ],
  });
  const diagnostic = screen.getByRole("region", {
    name: i18n.t("plans.runDiagnostics"),
  });
  expect(within(diagnostic).getByRole("alert")).toBeDefined();
  expect(
    within(diagnostic).getByText(i18n.t("plans.cancellation.confirmed")),
  ).toBeDefined();
  expect(
    within(
      screen.getByRole("list", { name: i18n.t("plans.sequence") }),
    ).getAllByRole("button"),
  ).toHaveLength(1);
});

it("rejects an HTML response instead of displaying it as the saved inputs", async () => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response("<p>Unexpected response</p>", {
      headers: { "Content-Type": "text/html" },
    }),
  );
  renderRun();
  fireEvent.click(
    within(details()).getByRole("button", {
      name: i18n.t("plans.session.prompt"),
    }),
  );
  expect(await screen.findByRole("alert")).toBeDefined();
  expect(screen.queryByText("Unexpected response")).toBeNull();
});

it.each(["paused", "cancelled"] as const)(
  "keeps %s agents neutral and preserves the named status",
  (status) => {
    renderRun({
      ...syntheticRun(),
      status,
      steps: [runStep("Agent", { status })],
    });
    const button = within(
      screen.getByRole("list", { name: i18n.t("plans.sequence") }),
    ).getByRole("button");
    expect(button.className).toContain("text-muted-foreground");
    expect(button.textContent).toContain(i18n.t(`plans.status.${status}`));
  },
);
