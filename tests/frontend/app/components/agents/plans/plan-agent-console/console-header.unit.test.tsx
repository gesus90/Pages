import { createRef } from "react";
import { fireEvent, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";

import { ConsoleHeader } from "@/app/components/agents/plans/plan-agent-console/console-header";

import { renderConsole } from "./console-fixture";
import { syntheticRun } from "../../page72-run-fixture";

it("shows node, provider, translated state, read-only mark, run choice and the way back", () => {
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
      state="waiting_for_input"
      isReadOnly
      headingRef={headingRef}
      onSelectRun={vi.fn()}
      onClose={onClose}
      onBack={onBack}
    />,
  );
  expect(screen.getByText("Group · PageAgentCLI")).toBeTruthy();
  expect(headingRef.current?.textContent).toBe("Review group · Writer");
  expect(screen.getByRole("status").textContent).toBe(
    "Codex CLI (ChatGPT account)Waiting for inputHistory · read only",
  );
  expect(
    screen.getByRole("combobox", { name: "Run of this node" }).textContent,
  ).toContain("2026-10-15T10:00:00.000Z · Running");
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
      state={null}
      isReadOnly={false}
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
  renderConsole(
    <ConsoleHeader
      title="Writer"
      nodeType="Agent"
      runs={[syntheticRun()]}
      run={null}
      provider={null}
      state={null}
      isReadOnly={false}
      headingRef={createRef<HTMLHeadingElement>()}
      onSelectRun={vi.fn()}
      onClose={vi.fn()}
    />,
  );
  expect(
    screen.getByRole("combobox", { name: "Run of this node" }).textContent,
  ).not.toContain("Running");
});
