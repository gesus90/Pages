import { fireEvent, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";

import {
  PanelField,
  PanelNote,
  PanelSwitch,
} from "@/app/components/agents/plans/plan-panel-controls";

import { renderTranslated } from "./plan-panel-fixture";

const INFO = { label: "About runs", text: "How often the loop runs." };

it("labels a field and offers its explanation on a press", () => {
  renderTranslated(
    <PanelField id="runs" label="Runs" info={INFO} className="col-span-2">
      <input id="runs" />
    </PanelField>,
  );
  const info = screen.getByRole("button", { name: "About runs" });

  expect(screen.getByRole("textbox", { name: "Runs" })).toBeDefined();
  expect(
    screen.getByText("Runs").parentElement?.parentElement?.className,
  ).toContain("col-span-2");
  fireEvent.click(info);

  expect(screen.getByRole("tooltip", { hidden: true }).textContent).toBe(
    "How often the loop runs.",
  );
});

it("shows a field without an explanation as a plain label", () => {
  renderTranslated(
    <PanelField id="name" label="Name">
      <input id="name" />
    </PanelField>,
  );

  expect(screen.getByRole("textbox", { name: "Name" })).toBeDefined();
  expect(screen.queryByRole("button")).toBeNull();
});

it("toggles a described switch and names its explanation", () => {
  const onChange = vi.fn();
  renderTranslated(
    <PanelSwitch
      label="Reuse session"
      info={INFO}
      description="Keeps the agent session."
      isChecked
      isDisabled={false}
      onChange={onChange}
    />,
  );
  const control = screen.getByRole("switch", { name: "Reuse session" });

  expect(control.getAttribute("aria-checked")).toBe("true");
  expect(
    document.getElementById(control.getAttribute("aria-describedby") ?? "")
      ?.textContent,
  ).toBe("Keeps the agent session.");
  expect(screen.getByRole("button", { name: "About runs" })).toBeDefined();
  fireEvent.click(control);

  expect(onChange).toHaveBeenCalledWith(false);
});

it("turns an undescribed switch on, and a disabled one not at all", () => {
  const onChange = vi.fn();
  const view = renderTranslated(
    <PanelSwitch
      label="Stop on failure"
      isChecked={false}
      isDisabled={false}
      onChange={onChange}
    />,
  );
  const control = screen.getByRole("switch", { name: "Stop on failure" });

  expect(control.getAttribute("aria-describedby")).toBeNull();
  expect(screen.queryByRole("button")).toBeNull();
  fireEvent.click(control);
  expect(onChange).toHaveBeenCalledWith(true);
  view.rerender(
    <PanelSwitch
      label="Stop on failure"
      isChecked={false}
      isDisabled
      onChange={onChange}
    />,
  );
  fireEvent.click(screen.getByRole("switch", { name: "Stop on failure" }));

  expect(onChange).toHaveBeenCalledOnce();
});

it("tints a note as neutral by default and as a warning on request", () => {
  renderTranslated(
    <>
      <PanelNote>Runs once.</PanelNote>
      <PanelNote tone="warning">Runs forever.</PanelNote>
    </>,
  );
  const [neutral, warning] = screen.getAllByRole("note");

  expect(neutral.textContent).toBe("Runs once.");
  expect(neutral.className).toContain("bg-muted");
  expect(warning.className).toContain("bg-warning-subtle");
});
