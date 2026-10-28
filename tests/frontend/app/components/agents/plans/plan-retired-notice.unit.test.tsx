import { screen } from "@testing-library/react";
import { expect, it } from "vitest";

import { PlanRetiredNotice } from "@/app/components/agents/plans/plan-retired-notice";

import { i18n, renderRouted } from "./plan-panel-fixture";

it("explains the replacement when an old agent-list bookmark opens the editor", () => {
  renderRouted(<PlanRetiredNotice />, "/agents/plans?notice=direct-models");

  expect(screen.getByRole("status").textContent).toBe(
    i18n.t("picaSettings.retired"),
  );
});

it.each(["/agents/plans", "/agents/plans?notice=other"])(
  "says nothing at %s",
  (address) => {
    const { container } = renderRouted(<PlanRetiredNotice />, address);

    expect(container.textContent).toBe("");
  },
);
