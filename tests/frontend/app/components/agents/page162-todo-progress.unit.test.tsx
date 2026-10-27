import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
} from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { afterEach, expect, it, vi } from "vitest";

import { PlanStatusHeader } from "@/app/components/agents/plans/plan-status-header";
import { PlanStatusDetails } from "@/app/components/agents/plans/plan-status-details";
import { PlanStatusTodoCount } from "@/app/components/agents/plans/plan-status-todo-count";
import { PlanStatusTodos } from "@/app/components/agents/plans/plan-status-todos";
import { planTodoSummary } from "@/app/components/agents/plans/plan-status-todo-model";
import { elapsedTime } from "@/app/components/agents/plans/plan-run-status-model";
import { usePlanStatusTime } from "@/app/components/agents/plans/use-plan-status-time";
import { createI18n } from "@/app/lib/i18n";
import { readPlanPollingResponse } from "@/app/lib/agent-plan-poll";

import type { AgentPlanRun, AgentPlanStepResult } from "@/definition/AgentPlan";
import type { AgentPlanProgressItem } from "@/definition/AgentPlanProgress";

const startedAt = "2026-10-27T18:00:00Z";

function stepWithTodos(
  statuses: readonly AgentPlanProgressItem["status"][],
): AgentPlanStepResult {
  return {
    id: "agent",
    name: "Synthetic ticket agent",
    status: "running",
    isBlocked: false,
    cancellation: "none",
    output: null,
    error: null,
    progress: {
      source: "live",
      observedAt: startedAt,
      availability: "observed",
      tickets: [{ id: "ticket", key: "SYN-162", contentHash: "observed" }],
      todos: statuses.map((status, index) => ({
        id: `ticket:item-${index}`,
        text: `Concrete work ${index}`,
        ticket: { id: "ticket", key: "SYN-162", itemId: `item-${index}` },
        status,
      })),
    },
  };
}

function runWithStep(step: AgentPlanStepResult): AgentPlanRun {
  return {
    id: "run",
    planId: "plan",
    planName: "Synthetic",
    planRevision: 1,
    userId: "executor",
    startedAt,
    status: "running",
    stopRequested: false,
    steps: [step],
  };
}

function mount(children: React.ReactElement): ReturnType<typeof render> {
  return render(
    <I18nextProvider i18n={createI18n("de")}>{children}</I18nextProvider>,
  );
}

afterEach(() => vi.useRealTimers());

it.each([
  [0, "00:00"],
  [3599, "59:59"],
  [3600, "1:00:00"],
  [3704, "1:01:44"],
  [14461, "4:01:01"],
  [90061, "25:01:01"],
])(
  "formats %i elapsed seconds as %s without changing the duration source",
  (seconds, expected) => {
    expect(
      elapsedTime(
        startedAt,
        new Date(Date.parse(startedAt) + seconds * 1000).toISOString(),
      ),
    ).toBe(expected);
  },
);

it("keeps unknown, invalid and negative durations honest", () => {
  expect(elapsedTime(undefined, startedAt)).toBe("—");
  expect(elapsedTime(startedAt, null)).toBe("—");
  expect(elapsedTime("invalid", startedAt)).toBe("—");
  expect(elapsedTime(startedAt, "2026-10-27T17:59:59Z")).toBe("—");
});

it("retains the existing active, paused, recovery and terminal clock behavior", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(startedAt));
  const run = runWithStep(stepWithTodos([]));
  const mounted = renderHook(
    ({ current }: { readonly current: AgentPlanRun }) =>
      usePlanStatusTime(current),
    { initialProps: { current: run } },
  );
  await act(() => vi.advanceTimersByTime(3704000));
  expect(elapsedTime(startedAt, mounted.result.current)).toBe("1:01:44");
  mounted.rerender({ current: { ...run, status: "paused" } });
  await act(() => vi.advanceTimersByTime(1000));
  expect(elapsedTime(startedAt, mounted.result.current)).toBe("1:01:45");
  mounted.rerender({ current: { ...run, id: "recovered" } });
  expect(elapsedTime(startedAt, mounted.result.current)).toBe("1:01:45");
  const endedAt = new Date(Date.parse(startedAt) + 3800000).toISOString();
  mounted.rerender({ current: { ...run, status: "succeeded", endedAt } });
  await act(() => vi.advanceTimersByTime(10000));
  expect(mounted.result.current).toBe(endedAt);
});

it("distinguishes confirmed empty lists, unavailable reads and prompt placeholders", () => {
  const step = stepWithTodos([]);
  const mounted = mount(<PlanStatusTodoCount step={step} />);
  expect(screen.getByRole("img").getAttribute("aria-label")).toContain(
    "Noch keine Arbeitsliste",
  );
  expect(screen.getByText("0/0")).toBeTruthy();
  expect(mounted.container.querySelectorAll("circle")).toHaveLength(1);
  mounted.rerender(
    <I18nextProvider i18n={createI18n("de")}>
      <PlanStatusTodoCount
        step={{
          ...step,
          progress: {
            source: "live",
            observedAt: startedAt,
            availability: "unavailable",
            todos: [],
          },
        }}
      />
    </I18nextProvider>,
  );
  expect(screen.getByRole("img").getAttribute("aria-label")).toContain(
    "keine TODO-Liste",
  );
  expect(mounted.container.querySelectorAll("circle")).toHaveLength(1);
  expect(
    planTodoSummary({
      ...step,
      progress: {
        source: "historical",
        observedAt: startedAt,
        todos: [
          { id: "T1", text: "Carry out the instruction", status: "done" },
        ],
      },
    }),
  ).toMatchObject({ isConfirmed: false, total: 0, completed: 0 });
});

it("allows new work to lower the observed fraction after reload instead of keeping a monotonic percentage", () => {
  const mounted = mount(<PlanStatusTodoCount step={stepWithTodos(["done"])} />);
  expect(screen.getByText("1/1")).toBeTruthy();
  mounted.rerender(
    <I18nextProvider i18n={createI18n("de")}>
      <PlanStatusTodoCount step={stepWithTodos(["done", "open"])} />
    </I18nextProvider>,
  );
  expect(screen.getByText("1/2")).toBeTruthy();
  expect(screen.getByRole("img").getAttribute("aria-label")).toContain(
    "SYN-162",
  );
});

it("does not treat a legacy empty starting snapshot as a confirmed empty ticket list", () => {
  const step = stepWithTodos([]);
  const summary = planTodoSummary({
    ...step,
    progress: {
      source: "historical",
      observedAt: startedAt,
      tickets: [{ id: "ticket", key: "SYN-162", contentHash: "unknown" }],
      todos: [],
    },
  });
  expect(summary.isConfirmed).toBe(false);
  expect(
    planTodoSummary({
      ...step,
      progress: {
        source: "historical",
        observedAt: startedAt,
        tickets: [{ id: "ticket", key: "SYN-162", contentHash: "unknown" }],
        todos: [
          {
            id: "ticket:reported",
            text: "Only a historical report",
            status: "done",
          },
        ],
      },
    }).isConfirmed,
  ).toBe(false);
});

it("retains confirmed checklist identities, counts and activity through the real polling parser after reconnect", () => {
  const step = stepWithTodos(["done", "active", "open"]);
  const current = {
    ...step,
    progress: {
      ...step.progress,
      source: "live" as const,
      observedAt: startedAt,
      todos: step.progress?.todos ?? [],
      scope: { runId: "run", stepId: "agent", attemptId: "retry" },
    },
  };
  const response = readPlanPollingResponse({
    ok: true,
    intent: "poll-run",
    run: runWithStep(current),
  });
  if (!response.ok || !response.run) throw new Error("Missing parsed run");
  expect(response.run.steps[0]?.progress).toEqual(current.progress);
  expect(planTodoSummary(response.run.steps[0])).toMatchObject({
    isConfirmed: true,
    completed: 1,
    active: 1,
    open: 1,
    total: 3,
  });
});

it("shows equal status boxes and explicit completed, active and next labels as read-only observations", () => {
  const mounted = mount(
    <PlanStatusTodos
      step={stepWithTodos(["done", "active", "open"])}
      number={2}
    />,
  );
  expect(screen.getByRole("heading", { name: "TODOs · SYN-162" })).toBeTruthy();
  expect(
    screen.getByText("1 erledigt · 1 in Arbeit · 1 als Nächstes"),
  ).toBeTruthy();
  expect(screen.getByText("Gerade in Arbeit")).toBeTruthy();
  expect(screen.getByText("Als Nächstes")).toBeTruthy();
  expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
  expect(screen.queryAllByRole("button")).toHaveLength(0);
  const boxes = mounted.container.querySelectorAll("li > span[aria-hidden]");
  expect(boxes).toHaveLength(3);
  expect([...boxes].every((box) => box.classList.contains("size-4"))).toBe(
    true,
  );
  expect(
    screen
      .getByText("Concrete work 1")
      .closest("li")
      ?.classList.contains("bg-status-active-subtle"),
  ).toBe(true);
});

it("shows ticket TODOs before retained technical run details within the same scrollable panel", () => {
  mount(
    <PlanStatusDetails
      step={stepWithTodos(["done", "active", "open"])}
      number={1}
      end={null}
      canLocate={false}
      onLocate={vi.fn()}
    />,
  );
  const todos = screen.getByRole("heading", { name: "TODOs · SYN-162" });
  const details = screen.getByRole("heading", {
    name: "Schritt 1 · Synthetic ticket agent",
  });
  expect(
    todos.compareDocumentPosition(details) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  expect(screen.getByText("Gerade in Arbeit")).toBeTruthy();
  expect(
    screen.getByText(
      "Für diesen Schritt liegt keine Runner-Konfiguration vor.",
    ),
  ).toBeTruthy();
});

it("places the TODO count immediately before the existing clock and preserves the single toggle", () => {
  const step = stepWithTodos(["done", "open"]);
  const onToggle = vi.fn();
  const mounted = mount(
    <PlanStatusHeader
      run={runWithStep(step)}
      steps={[step]}
      preview={{ steps: [], gaps: [] }}
      end="2026-10-27T19:01:44Z"
      anchorId="agent"
      selectedId="agent"
      isOpen={false}
      contentId="details"
      error={null}
      onSelect={vi.fn()}
      onToggle={onToggle}
    />,
  );
  const count = screen.getByText("1/2").closest('[role="img"]');
  expect(count?.nextElementSibling?.textContent).toBe("1:01:44");
  expect(screen.getAllByRole("button", { expanded: false })).toHaveLength(1);
  fireEvent.click(screen.getByRole("button", { expanded: false }));
  expect(onToggle).toHaveBeenCalledTimes(1);
  expect(
    mounted.container.querySelector('[aria-controls="details"]'),
  ).toBeTruthy();
});
