import { expect, it } from "vitest";

import {
  PLAN_RUN_PURGE_BATCH_SIZE,
  PLAN_RUN_SETTLEMENT_RULES,
  SETTLED_PLAN_RUN,
} from "./AgentPlanRunRetention";

it("joins every settlement condition into one predicate", () => {
  expect(PLAN_RUN_PURGE_BATCH_SIZE).toBe(64);
  for (const rule of PLAN_RUN_SETTLEMENT_RULES)
    expect(SETTLED_PLAN_RUN).toContain(`(${rule.condition})`);
  expect(SETTLED_PLAN_RUN.split("\n    AND ")).toHaveLength(
    PLAN_RUN_SETTLEMENT_RULES.length,
  );
});
