import { createRef } from "react";
import { act, fireEvent, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";

import { ConsoleHeader } from "@/app/components/agents/plans/plan-agent-console/console-header";

import { renderConsole } from "./console-fixture";
import { syntheticRun } from "../../page72-run-fixture";

it("shows node, provider and translated state as pills, run choice and the way back", () => {
  const onBack = vi.fn();
  const onClose = vi.fn();
  const headingRef = createRef<HTMLHeadingElement>();
  const run = syntheticRun();
  const older = { ...run, id: "older-run", status: "succeeded" as const };
  renderConsole(
    <ConsoleHeader
      title="Review group · Writer"
      nodeType="Group"
      runs={[run, older]}
      run={run}
      provider="codex_cli"
      stateLabel="Waiting for input"
      headingRef={headingRef}
      onSelectRun={vi.fn()}
      onClose={onClose}
      onBack={onBack}
    />,
  );
  expect(screen.getByText("Group · Agent session")).toBeTruthy();
  expect(headingRef.current?.textContent).toBe("Review group · Writer");
  expect(screen.getByRole("status").textContent).toBe(
    "Codex CLI (ChatGPT account)Waiting for input",
  );
  expect(
    screen.getByRole("combobox", { name: "Run of this node" }).textContent,
  ).toMatch(/2026.* · Running$/u);
  fireEvent.click(
    screen.getByRole("button", { name: "Back to the group members" }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Close agent console" }));
  expect(onBack).toHaveBeenCalledOnce();
  expect(onClose).toHaveBeenCalledOnce();
});

it("leaves out provider, state, run choice and the way back when nothing reported them", () => {
  renderConsole(
    <ConsoleHeader
      title="Writer"
      nodeType="Agent"
      runs={[]}
      run={null}
      provider={null}
      stateLabel={null}
      headingRef={createRef<HTMLHeadingElement>()}
      onSelectRun={vi.fn()}
      onClose={vi.fn()}
    />,
  );
  expect(screen.getByRole("status").textContent).toBe("");
  expect(screen.queryByRole("combobox")).toBeNull();
  expect(screen.getAllByRole("button")).toHaveLength(1);
});

it("offers the runs without a selection while no run is chosen", () => {
  const run = syntheticRun();
  renderConsole(
    <ConsoleHeader
      title="Writer"
      nodeType="Agent"
      runs={[run, { ...run, id: "older-run", status: "succeeded" as const }]}
      run={null}
      provider={null}
      stateLabel={null}
      headingRef={createRef<HTMLHeadingElement>()}
      onSelectRun={vi.fn()}
      onClose={vi.fn()}
    />,
  );
  expect(
    screen.getByRole("combobox", { name: "Run of this node" }).textContent,
  ).not.toMatch(/Running|Succeeded/u);
});

it("offers no run choice while the node has only one run", () => {
  renderConsole(
    <ConsoleHeader
      title="Writer"
      nodeType="Agent"
      runs={[syntheticRun()]}
      run={syntheticRun()}
      provider={null}
      stateLabel={null}
      headingRef={createRef<HTMLHeadingElement>()}
      onSelectRun={vi.fn()}
      onClose={vi.fn()}
    />,
  );
  expect(screen.queryByRole("combobox")).toBeNull();
});

it("stops the run from the header only after the question was confirmed", async () => {
  const onStopRun = vi.fn(async () => undefined);
  renderConsole(
    <ConsoleHeader
      title="Writer"
      nodeType="Agent"
      runs={[]}
      run={{ ...syntheticRun(), manualInputAt: "2026-10-15T10:05:00.000Z" }}
      provider="claude_code"
      stateLabel="Turn running"
      headingRef={createRef<HTMLHeadingElement>()}
      onSelectRun={vi.fn()}
      onClose={vi.fn()}
      onStopRun={onStopRun}
    />,
  );
  expect(screen.getByText("Manually intervened")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Stop run" }));
  expect(onStopRun).not.toHaveBeenCalled();
  expect(screen.getByRole("dialog", { name: "Stop run?" })).toBeTruthy();
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Yes, stop run" }));
    await Promise.resolve();
  });
  expect(onStopRun).toHaveBeenCalledOnce();
});

it("marks a run whose work is done but whose closeout is still open", () => {
  renderConsole(
    <ConsoleHeader
      title="Writer"
      nodeType="Agent"
      runs={[]}
      run={{ ...syntheticRun(), status: "work_done_closeout_open" }}
      provider={null}
      stateLabel={null}
      headingRef={createRef<HTMLHeadingElement>()}
      onSelectRun={vi.fn()}
      onClose={vi.fn()}
    />,
  );
  expect(screen.getByRole("status").textContent).toBe(
    "Work done, closeout open",
  );
  expect(screen.queryByText("Manually intervened")).toBeNull();
});
