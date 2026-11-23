import { expect, it, vi } from "vitest";

import { recordPlanChange } from "./AgentPlanChangeNotification";

import type { DatabaseTransaction } from "@/backend/database/Database";

it("appends the catalog event to the outbox and notifies the live hub", async () => {
  const execute = vi.fn<DatabaseTransaction["execute"]>(async () => {});

  await recordPlanChange({ execute });

  expect(execute).toHaveBeenCalledTimes(2);
  expect(execute.mock.calls[0]?.[1]).toMatchObject({
    kind: "plan.catalog.changed",
    object_id: "catalog",
  });
  expect(execute.mock.calls[1]?.[1]).toEqual({
    channel: "pages_live_changes",
    payload: JSON.stringify({ type: "plan.catalog.changed", id: "catalog" }),
  });
});
