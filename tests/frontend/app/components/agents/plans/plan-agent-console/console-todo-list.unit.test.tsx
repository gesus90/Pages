import {
  act,
  cleanup,
  fireEvent,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { ConsoleSidebar } from "@/app/components/agents/plans/plan-agent-console/console-sidebar";
import { ConsoleTodoList } from "@/app/components/agents/plans/plan-agent-console/console-todo-list";

import { cliStep, renderConsole, sessionView } from "./console-fixture";

import type * as FloatingUi from "@floating-ui/dom";
import type { AgentPlanAgentTodo } from "@/definition/AgentPlanAgentTodos";
import type { AgentPlanProgressItem } from "@/definition/AgentPlanProgress";

const floating = vi.hoisted(() => ({
  computePosition: vi.fn(),
  autoUpdate: vi.fn(),
  stop: vi.fn(),
}));

vi.mock("@floating-ui/dom", async (importOriginal) => ({
  ...(await importOriginal<typeof FloatingUi>()),
  computePosition: floating.computePosition,
  autoUpdate: floating.autoUpdate,
}));
vi.mock(
  "@/app/components/agents/plans/plan-agent-console/use-terminal-surface",
  () => ({ useNow: () => 1_790_000_000_000 }),
);

const HIDDEN = { hidden: true } as const;
const FALLBACK: readonly AgentPlanProgressItem[] = [
  { id: "T1", contractId: "T1", text: "Ticket task", status: "done" },
  { id: "T2", contractId: "T2", text: "Instruction task", status: "open" },
];
const NATIVE: readonly AgentPlanAgentTodo[] = [
  { id: "1", text: "Finished task", status: "done", updatedAt: "now" },
  { id: "2", text: "Failed task", status: "failed", updatedAt: "now" },
  { id: "3", text: "Current task", status: "active", updatedAt: "now" },
  { id: "4", text: "Upcoming task", status: "open", updatedAt: "now" },
];

function stepWithTodos(
  todos?: readonly AgentPlanAgentTodo[],
): ReturnType<typeof cliStep> {
  return cliStep({
    progress: { source: "live", observedAt: "now", todos: FALLBACK },
    ...(todos
      ? { agentTodos: { attemptId: "attempt", updatedAt: "now", todos } }
      : {}),
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  floating.computePosition.mockResolvedValue({ x: 8, y: 16 });
  floating.autoUpdate.mockImplementation(
    (reference: Element, panel: HTMLElement, update: () => void) => {
      update();
      return floating.stop;
    },
  );
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.resetAllMocks();
});

it("shows one To Do section using only the agent list, with its own count and unchanged sidebar facts", () => {
  renderConsole(
    <ConsoleSidebar step={stepWithTodos(NATIVE)} view={sessionView()} />,
  );

  expect(screen.getAllByRole("heading", { name: "To Do" })).toHaveLength(1);
  expect(screen.getAllByRole("list")).toHaveLength(1);
  expect(screen.getAllByRole("listitem")).toHaveLength(4);
  expect(screen.getByText("1 / 4")).toBeTruthy();
  expect(screen.queryByText("T1 Ticket task")).toBeNull();
  for (const name of ["Activity", "Usage", "Session"])
    expect(screen.getByRole("heading", { name })).toBeTruthy();
  expect(screen.getByText("Runtime")).toBeTruthy();
  expect(screen.getByRole("meter", { name: "Context" })).toBeTruthy();
  expect(screen.queryByRole("checkbox")).toBeNull();
});

it("falls back to progress and contract tasks and respects a reported empty agent list", () => {
  const mounted = renderConsole(<ConsoleTodoList step={stepWithTodos()} />);
  expect(screen.getByText("1 / 2")).toBeTruthy();
  expect(screen.getByText("T1 Ticket task")).toBeTruthy();

  mounted.rerender(<ConsoleTodoList step={cliStep()} />);
  expect(screen.getByText("T1 Read requirements")).toBeTruthy();
  expect(screen.getAllByRole("listitem")).toHaveLength(3);
  mounted.rerender(<ConsoleTodoList step={stepWithTodos([])} />);
  expect(screen.getByText("0 / 0")).toBeTruthy();
  expect(screen.getByText("No todos")).toBeTruthy();
  expect(screen.queryByRole("list")).toBeNull();
});

it("switches sources on live updates and counts only successful entries", () => {
  const mounted = renderConsole(<ConsoleTodoList step={stepWithTodos()} />);
  mounted.rerender(<ConsoleTodoList step={stepWithTodos(NATIVE)} />);
  expect(screen.getByText("1 / 4")).toBeTruthy();
  expect(screen.queryByText("T1 Ticket task")).toBeNull();
  const updated = NATIVE.map((todo): AgentPlanAgentTodo =>
    todo.id === "3" ? { ...todo, status: "done" } : todo,
  );
  mounted.rerender(<ConsoleTodoList step={stepWithTodos(updated)} />);
  expect(screen.getByText("2 / 4")).toBeTruthy();
  expect(screen.queryByRole("img", { name: "in progress" })).toBeNull();
  expect(screen.getByRole("img", { name: "failed" })).toBeTruthy();
});

it.each(["failed", "cancelled", "succeeded"] as const)(
  "does not manufacture task outcomes from a %s run or unknown progress",
  (status) => {
    const step = cliStep({
      status,
      progress: {
        source: "live",
        observedAt: "now",
        todos: (["open", "missing", "unreported"] as const).map(
          (state, index) => ({
            id: String(index),
            text: `Unknown ${index}`,
            status: state,
          }),
        ),
      },
    });
    renderConsole(<ConsoleTodoList step={step} />);
    expect(screen.getByText("0 / 3")).toBeTruthy();
    expect(screen.queryByRole("img", { name: "failed" })).toBeNull();
    expect(screen.queryByRole("img", { name: "in progress" })).toBeNull();
    expect(screen.getAllByRole("img")).toHaveLength(3);
  },
);

it("uses compact ellipsis text beside filled status marks, without a row border and with visible keyboard focus", () => {
  renderConsole(<ConsoleTodoList step={stepWithTodos(NATIVE)} />);
  const buttons = screen.getAllByRole("button");
  for (const button of buttons) {
    expect(button.querySelector("span.truncate")?.className).toContain(
      "min-w-0",
    );
    expect(button.className).toContain("focus-visible:bg-agent-console-track");
    expect(button.className).toContain("focus-visible:outline-none");
    expect(button.className.split(" ").includes("border")).toBe(false);
    expect(button.closest("li")?.className.split(" ").includes("border")).toBe(
      false,
    );
    expect(button.querySelector("[title]")).toBeNull();
    expect(button.hasAttribute("title")).toBe(false);
  }
  for (const [label, token] of [
    ["done", "done"],
    ["in progress", "active"],
    ["failed", "failed"],
  ]) {
    const mark = screen.getByRole("img", { name: label });
    expect(mark.className).toContain(`bg-plan-todo-${token}`);
    expect(mark.className).toContain("text-plan-todo-label");
    expect(mark.querySelector("svg")).toBeTruthy();
  }
  const active = screen.getByRole("img", { name: "in progress" });
  expect(active.querySelector("svg")?.getAttribute("class")).toContain(
    "motion-safe:animate-spin",
  );
  expect(
    screen.getByRole("img", { name: "open" }).querySelector("svg"),
  ).toBeNull();
});

it("waits exactly 1500 ms per uninterrupted hover and resets after leaving or changing rows", async () => {
  renderConsole(<ConsoleTodoList step={stepWithTodos(NATIVE)} />);
  const first = screen.getByRole("button", { name: /Finished task/ });
  const second = screen.getByRole("button", { name: /Failed task/ });
  fireEvent.mouseEnter(first);
  await act(() => vi.advanceTimersByTime(1499));
  expect(screen.queryByRole("tooltip", HIDDEN)).toBeNull();
  fireEvent.mouseLeave(first);
  fireEvent.mouseEnter(first);
  await act(() => vi.advanceTimersByTime(1499));
  expect(screen.queryByRole("tooltip", HIDDEN)).toBeNull();
  await act(async () => vi.advanceTimersByTime(1));
  expect(screen.getByRole("tooltip").textContent).toBe("Finished task");
  fireEvent.mouseLeave(first);
  expect(screen.queryByRole("tooltip", HIDDEN)).toBeNull();
  fireEvent.mouseEnter(second);
  await act(() => vi.advanceTimersByTime(1499));
  expect(screen.queryByRole("tooltip", HIDDEN)).toBeNull();
  await act(async () => vi.advanceTimersByTime(1));
  expect(screen.getByRole("tooltip").textContent).toBe("Failed task");
});

it("exposes full text on keyboard focus in a viewport-positioned portal and dismisses Escape without closing the panel", async () => {
  const text = "A very long task with details ".repeat(12);
  renderConsole(
    <ConsoleTodoList
      step={stepWithTodos([
        { id: "long", text, status: "open", updatedAt: "now" },
      ])}
    />,
  );
  const button = screen.getByRole("button", { name: `open: ${text.trim()}` });
  await act(async () => fireEvent.focus(button));
  const tooltip = screen.getByRole("tooltip");
  expect(tooltip.textContent).toBe(text);
  expect(button.getAttribute("aria-describedby")).toBe(tooltip.id);
  expect(tooltip.parentElement).toBe(document.body);
  expect(tooltip.className).toContain("wrap-anywhere");
  expect(tooltip.className).toContain("100vw");
  expect(floating.computePosition).toHaveBeenCalledWith(
    expect.any(HTMLElement),
    tooltip,
    expect.objectContaining({ strategy: "fixed" }),
  );
  expect(floating.computePosition.mock.calls[0]?.[2].middleware).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ name: "flip" }),
      expect.objectContaining({ name: "shift" }),
    ]),
  );
  expect(fireEvent.keyDown(button, { key: "Escape" })).toBe(false);
  expect(screen.queryByRole("tooltip", HIDDEN)).toBeNull();
  fireEvent.blur(button);
  await act(async () => fireEvent.focus(button));
  expect(screen.getByRole("tooltip")).toBeTruthy();
  fireEvent.blur(button);
  expect(screen.queryByRole("tooltip", HIDDEN)).toBeNull();
});

it("cancels a pending hover when a live source replacement removes the task", async () => {
  const mounted = renderConsole(<ConsoleTodoList step={stepWithTodos()} />);
  fireEvent.mouseEnter(
    within(screen.getByRole("list")).getAllByRole("button")[0],
  );
  await act(() => vi.advanceTimersByTime(1000));
  mounted.rerender(<ConsoleTodoList step={stepWithTodos(NATIVE)} />);
  await act(() => vi.advanceTimersByTime(1500));
  expect(screen.queryByRole("tooltip", HIDDEN)).toBeNull();
});
