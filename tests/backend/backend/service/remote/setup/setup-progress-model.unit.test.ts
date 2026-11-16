import { expect, it } from "vitest";

import {
  applyMarker,
  failedProgress,
  finishedProgress,
  preparationStep,
  startedProgress,
} from "@/backend/service/remote/setup/SetupProgressModel";

it("accepts phases in order and never reopens a finished phase", () => {
  const started = startedProgress();
  expect(started.phases[0]).toBe("running");
  expect(applyMarker(started, { phase: 2, state: "running", step: "" })).toBe(
    started,
  );
  const first = applyMarker(started, { phase: 1, state: "done", step: "" });
  expect(first.phases[0]).toBe("done");
  expect(first.step).toBeNull();
  expect(applyMarker(first, { phase: 1, state: "running", step: "" })).toBe(
    first,
  );
  expect(
    applyMarker(first, { phase: 2, state: "running", step: "" }).phases[1],
  ).toBe("running");
});

it("records failure once and closes unsettled phases on a partial outcome", () => {
  const failed = failedProgress(startedProgress(), { reason: "offline" });
  expect(failed).toMatchObject({ outcome: "failed", reason: "offline" });
  expect(failed.phases[0]).toBe("failed");
  expect(preparationStep(failed, "upload")).toBe(failed);
  expect(failedProgress(failed, { reason: "other" })).toBe(failed);
  const partial = finishedProgress(startedProgress(), {
    outcome: "partial",
    reason: "offline",
  });
  expect(partial).toMatchObject({
    outcome: "partial",
    step: null,
    reason: "offline",
  });
  expect(partial.phases).not.toContain("running");
});
