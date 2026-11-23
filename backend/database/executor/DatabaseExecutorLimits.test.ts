import { expect, it } from "vitest";

import { DATABASE_EXECUTOR_LIMITS } from "@/backend/database/executor/DatabaseExecutorLimits";

it("keeps positive budgets and bounds", () => {
  for (const value of Object.values(DATABASE_EXECUTOR_LIMITS)) {
    if (typeof value === "number") expect(value).toBeGreaterThan(0);
  }
  expect(DATABASE_EXECUTOR_LIMITS.maximumQueuedBackgroundWrites).toBeLessThan(
    DATABASE_EXECUTOR_LIMITS.maximumQueuedWrites,
  );
});
