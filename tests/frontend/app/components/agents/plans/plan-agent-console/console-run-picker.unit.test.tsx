import { fireEvent, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";

import { ConsoleRunPicker } from "@/app/components/agents/plans/plan-agent-console/console-run-picker";

import { renderConsole } from "./console-fixture";
import { syntheticRun } from "../../page72-run-fixture";

it("opens with the selected run and selects another with the keyboard", () => {
  const run = syntheticRun();
  const onSelect = vi.fn();
  renderConsole(
    <ConsoleRunPicker
      runs={[run, { ...run, id: "older", status: "succeeded" }]}
      selectedId={run.id}
      ariaLabel="Run history"
      onSelect={onSelect}
    />,
  );
  const trigger = screen.getByRole("combobox");
  fireEvent.keyDown(trigger, { key: "ArrowDown" });
  const list = screen.getByRole("listbox");
  expect(
    screen
      .getAllByRole("option")
      .map((option) => option.getAttribute("aria-selected")),
  ).toEqual(["true", "false"]);
  fireEvent.keyDown(list, { key: "End" });
  fireEvent.keyDown(list, { key: "Enter" });
  expect(onSelect).toHaveBeenCalledWith("older");
  expect(screen.queryByRole("listbox")).toBeNull();
  expect(document.activeElement).toBe(trigger);
});

it("closes on outside press, Escape and Tab and supports pointer selection", () => {
  const run = syntheticRun();
  const onSelect = vi.fn();
  renderConsole(
    <ConsoleRunPicker
      runs={[run]}
      selectedId="missing"
      ariaLabel="Run"
      onSelect={onSelect}
    />,
  );
  const trigger = screen.getByRole("combobox");
  expect(trigger.textContent).toBe("");
  fireEvent.click(trigger);
  fireEvent.pointerDown(document.body);
  expect(screen.queryByRole("listbox")).toBeNull();
  fireEvent.click(trigger);
  fireEvent.keyDown(screen.getByRole("listbox"), { key: "Escape" });
  expect(document.activeElement).toBe(trigger);
  fireEvent.click(trigger);
  fireEvent.keyDown(screen.getByRole("listbox"), { key: "Tab" });
  expect(screen.queryByRole("listbox")).toBeNull();
  fireEvent.click(trigger);
  fireEvent.click(screen.getByRole("option"));
  expect(onSelect).toHaveBeenCalledWith(run.id);
});
