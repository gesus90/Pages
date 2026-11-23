import { expect, it, vi } from "vitest";

import { AgentRunActivityRepository } from "./AgentRunActivityRepository";

it("reads the newest times of attempts, steps and logs", async () => {
  const query = vi
    .fn()
    .mockResolvedValueOnce([["a1", "2026-01-01"]])
    .mockResolvedValueOnce([
      ["s1", "2026-01-02"],
      ["s2", null],
    ])
    .mockResolvedValueOnce([["a1", "2026-01-03"]]);

  const activity = await new AgentRunActivityRepository({ query }).read("r1");

  expect(activity.attemptEvents).toEqual(new Map([["a1", "2026-01-01"]]));
  expect(activity.stepProgress).toEqual(new Map([["s1", "2026-01-02"]]));
  expect(activity.attemptLogs).toEqual(new Map([["a1", "2026-01-03"]]));
  expect(query.mock.calls[0]?.[1]).toEqual({ run_id: "r1" });
});
