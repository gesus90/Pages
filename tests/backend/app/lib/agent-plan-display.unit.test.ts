import { expect, it } from "vitest";

import {
  displayPlanCheckpoint,
  displayPlanRun,
} from "@/app/lib/agent-plan-display.server";
import { createPlanCheckpoint } from "@/backend/service/agents/recovery/AgentPlanCheckpoint";
import { planContentDigest } from "@/backend/agents/AgentPlanContentDigest";

import {
  patchRecoveryStep,
  recoveryFixture,
} from "../../backend/service/agents/page84-recovery-fixture";

it("filters only the UI projection and leaves the durable result and checkpoint digest intact", async () => {
  const fixture = await recoveryFixture();
  const original = fixture.completed.steps.find((step) => step.id === "a");
  if (!original?.session?.acceptance)
    throw new Error("Expected a synthetic session");
  const sensitive = "password" + "=" + "synthetic-value";
  const run = patchRecoveryStep(fixture.completed, "a", {
    output: `Result ${sensitive}`,
    session: {
      ...original.session,
      events: [`Event ${sensitive}`],
      acceptance: {
        ...original.session.acceptance,
        summary: `Summary ${sensitive}`,
      },
    },
  });
  const before = structuredClone(run);
  const display = displayPlanRun(run);
  expect(display.steps[0]).toMatchObject({
    isDisplayFiltered: true,
    output: "Result [redacted]",
    session: {
      events: ["Event [redacted]"],
      acceptance: { summary: "Summary [redacted]" },
    },
  });
  expect(run).toEqual(before);
  const base = createPlanCheckpoint(run, fixture.snapshot, "a");
  const output = run.steps[0]?.output ?? null;
  const checkpoint = {
    ...base,
    result: {
      ...base.result,
      output,
      outputDigest: planContentDigest(output),
      isOutputReduced: false,
    },
    version: 1,
    runRevision: 1,
  };
  const visible = displayPlanCheckpoint(checkpoint);
  expect(visible).toMatchObject({
    isDisplayFiltered: true,
    result: {
      isOutputReduced: true,
      output: "Result [redacted]",
      outputDigest: checkpoint.result.outputDigest,
    },
  });
  expect(checkpoint.result.output).toBe(run.steps[0]?.output);
});
