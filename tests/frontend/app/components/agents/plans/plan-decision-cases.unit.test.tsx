import { fireEvent, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";

import { PlanDecisionCases } from "@/app/components/agents/plans/plan-decision-dialog/plan-decision-cases";

import { i18n, renderTranslated } from "./plan-group-fixture";

const cases = [
  { id: "a", name: "Yes" },
  { id: "b", name: "No" },
];

it("renames and removes unconnected values, and adds a new empty value", () => {
  const onChange = vi.fn(
    (entries: readonly { id: string; name: string }[]) => entries,
  );
  renderTranslated(
    <PlanDecisionCases
      cases={cases}
      isDisabled={false}
      isConnected={() => false}
      onChange={onChange}
    />,
  );
  fireEvent.change(
    screen.getByLabelText(
      i18n.t("plans.decision.dialog.caseName", { number: 1 }),
    ),
    { target: { value: "Maybe" } },
  );
  expect(onChange).toHaveBeenLastCalledWith([
    { id: "a", name: "Maybe" },
    cases[1],
  ]);
  fireEvent.click(
    screen.getByRole("button", {
      name: i18n.t("plans.decision.dialog.removeCase", { name: "No" }),
    }),
  );
  expect(onChange).toHaveBeenLastCalledWith([cases[0]]);
  fireEvent.click(
    screen.getByRole("button", {
      name: i18n.t("plans.decision.dialog.addCase"),
    }),
  );
  const added = onChange.mock.lastCall?.[0];
  expect(added?.slice(0, 2)).toEqual(cases);
  expect(added?.[2]?.name).toBe("");
  expect(added?.[2]?.id).toMatch(/.+/);
});

it("requires confirmation to remove a connected value and supports cancellation", () => {
  const onChange = vi.fn(
    (entries: readonly { id: string; name: string }[]) => entries,
  );
  renderTranslated(
    <PlanDecisionCases
      cases={cases}
      isDisabled={false}
      isConnected={(id) => id === "a"}
      onChange={onChange}
    />,
  );
  const remove = screen.getByRole("button", {
    name: i18n.t("plans.decision.dialog.removeCase", { name: "Yes" }),
  });
  fireEvent.click(remove);
  expect(screen.getByRole("alertdialog")).toBeDefined();
  fireEvent.click(
    screen.getByRole("button", { name: i18n.t("settings.agents.cancel") }),
  );
  expect(screen.queryByRole("alertdialog")).toBeNull();
  expect(onChange).not.toHaveBeenCalled();
  fireEvent.click(remove);
  fireEvent.click(
    screen.getByRole("button", {
      name: i18n.t("plans.decision.dialog.removeConfirm"),
    }),
  );
  expect(onChange).toHaveBeenCalledWith([cases[1]]);
});
