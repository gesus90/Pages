import { renderHook } from "@testing-library/react";
import { expect, it, vi } from "vitest";

import {
  PlanFlowContext,
  usePlanFlowContext,
} from "@/app/components/agents/plans/plan-flow-context";

import { flowContext } from "./plan-flow-fixture";

it("hands nodes and edges the actions of the canvas", () => {
  const context = flowContext();

  const { result } = renderHook(() => usePlanFlowContext(), {
    wrapper: ({ children }: { readonly children: React.ReactNode }) => (
      <PlanFlowContext.Provider value={context}>
        {children}
      </PlanFlowContext.Provider>
    ),
  });

  expect(result.current).toBe(context);
});

it("refuses a node rendered outside the canvas", () => {
  // React reports the thrown render error on the console as well.
  vi.spyOn(console, "error").mockImplementation(() => {});

  expect(() => renderHook(() => usePlanFlowContext())).toThrow(
    "Plan flow context is missing",
  );
});
