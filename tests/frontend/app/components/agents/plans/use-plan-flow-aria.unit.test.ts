import { renderHook } from "@testing-library/react";
import { expect, it } from "vitest";

import { usePlanFlowAria } from "@/app/components/agents/plans/use-plan-flow-aria";
import { createI18n } from "@/app/lib/i18n";

const i18n = createI18n("en");

it("describes the grid's keyboard use in the current language", () => {
  const { result } = renderHook(() => usePlanFlowAria());
  const labels = result.current;
  expect(labels["node.a11yDescription.default"]).toBe(
    i18n.t("plans.flow.nodeKeys"),
  );
  expect(labels["node.a11yDescription.keyboardDisabled"]).toBe(
    i18n.t("plans.flow.nodeReadOnlyKeys"),
  );
  expect(labels["edge.a11yDescription.default"]).toBe(
    i18n.t("plans.flow.edgeKeys"),
  );
  const moved = labels["node.a11yDescription.ariaLiveMessage"];
  if (!moved) throw new Error("Expected the move announcement");
  expect(moved({ direction: "right", x: 40, y: 80 })).toBe(
    i18n.t("plans.flow.nodeMoved", { x: 40, y: 80 }),
  );
});
