import { describe, expect, it } from "vitest";

import { INITIAL_SETUP_PROGRESS } from "@/definition/RemoteSetup";

import {
  applyMarker,
  currentPhaseIndex,
  failedProgress,
  finishedProgress,
  preparationStep,
  startedProgress,
} from "./SetupProgressModel";

import type { SetupPhaseState, SetupProgress } from "@/definition/RemoteSetup";

function progressOf(
  phases: readonly SetupPhaseState[],
  overrides: Partial<SetupProgress> = {},
): SetupProgress {
  const full = [...phases];
  while (full.length < 8) full.push("pending");
  return { ...INITIAL_SETUP_PROGRESS, phases: full, ...overrides };
}

describe("startedProgress", () => {
  it("runs the first phase at the first preparation step", () => {
    const progress = startedProgress();

    expect(progress.phases[0]).toBe("running");
    expect(progress.step).toBe("rights");
  });
});

describe("preparationStep", () => {
  it("moves the step", () => {
    expect(preparationStep(startedProgress(), "upload").step).toBe("upload");
  });

  it("leaves a stopped run alone", () => {
    const outcome = progressOf([], { outcome: "failed" });
    const failed = progressOf(["failed"]);

    expect(preparationStep(outcome, "upload")).toBe(outcome);
    expect(preparationStep(failed, "upload")).toBe(failed);
  });
});

describe("applyMarker", () => {
  it("accepts the next phase and clears the step for phase one", () => {
    const progress = applyMarker(startedProgress(), {
      phase: 1,
      state: "running",
      step: "",
    });

    expect(progress.step).toBeNull();
    expect(
      applyMarker(progressOf(["done"]), {
        phase: 2,
        state: "running",
        step: "",
      }).phases[1],
    ).toBe("running");
  });

  it("keeps the step when phase one reports a failure", () => {
    const progress = applyMarker(startedProgress(), {
      phase: 1,
      state: "failed",
      step: "",
    });

    expect(progress.phases[0]).toBe("failed");
    expect(progress.step).toBe("rights");
  });

  it("ignores reports that break the rules", () => {
    const base = progressOf(["done"]);
    const marker = { state: "running", step: "" } as const;

    expect(applyMarker(base, { ...marker, phase: 99 })).toBe(base);
    expect(applyMarker(base, { ...marker, phase: 1 })).toBe(base);
    expect(applyMarker(base, { ...marker, phase: 4 })).toBe(base);
    const stopped = progressOf(["done"], { outcome: "failed" });
    expect(applyMarker(stopped, { ...marker, phase: 2 })).toBe(stopped);
  });
});

describe("currentPhaseIndex", () => {
  it("finds an active phase, the first unfinished one or the end", () => {
    expect(currentPhaseIndex(progressOf(["done", "waiting"]))).toBe(1);
    expect(currentPhaseIndex(progressOf(["done", "skipped"]))).toBe(2);
    expect(currentPhaseIndex(progressOf(Array(8).fill("done")))).toBe(8);
  });
});

describe("failedProgress", () => {
  it("fails the current phase", () => {
    const progress = failedProgress(progressOf(["done", "running"]), {
      reason: "remote.error.x",
    });

    expect(progress.phases[1]).toBe("failed");
    expect(progress.outcome).toBe("failed");
    expect(progress.reason).toBe("remote.error.x");
  });

  it("only records the ending when a phase already failed", () => {
    const progress = failedProgress(progressOf(["done", "failed"]), {
      reason: "remote.error.x",
      outcome: "partial",
    });

    expect(progress.phases[1]).toBe("failed");
    expect(progress.outcome).toBe("partial");
  });

  it("keeps the phases when all are settled", () => {
    const progress = failedProgress(progressOf(Array(8).fill("done")), {
      reason: "remote.error.x",
    });

    expect(progress.phases).toEqual(Array(8).fill("done"));
    expect(progress.outcome).toBe("failed");
  });

  it("never overwrites an outcome", () => {
    const ended = progressOf([], { outcome: "partial" });

    expect(failedProgress(ended, { reason: "remote.error.x" })).toBe(ended);
  });
});

describe("finishedProgress", () => {
  it("completes the last phase when confirmed", () => {
    const progress = finishedProgress(
      progressOf(Array(7).fill("done"), { step: "start" }),
      { outcome: "confirmed", reason: null },
    );

    expect(progress.phases[7]).toBe("done");
    expect(progress.step).toBeNull();
    expect(progress.outcome).toBe("confirmed");
  });

  it("skips phases that were still active without a result", () => {
    const progress = finishedProgress(
      progressOf(["done", "running", "waiting", "failed"]),
      { outcome: "partial", reason: "remote.setup.reason.stopped" },
    );

    expect(progress.phases.slice(0, 5)).toEqual([
      "done",
      "skipped",
      "skipped",
      "failed",
      "pending",
    ]);
  });
});
