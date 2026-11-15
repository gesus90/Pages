import { expect, it } from "vitest";

import {
  isEndedResumable,
  planControl,
  planResumeKind,
} from "@/backend/service/agents/AgentPlanControl";
import { planBlockerClassOf } from "@/backend/service/agents/AgentPlanBlockerRules";

import { parameterRunFixture } from "./page55-run-fixture";

it("offers only Pause and Stop while running and only Start after Stop", async () => {
  const { run, snapshot } = await parameterRunFixture();
  const plan = {
    ...snapshot.plan,
    projectName: "Synthetic project",
    canEdit: true,
    github: null,
  };
  const context = { userId: run.userId, hasReservation: false };
  const running = planControl(plan, { ...run, status: "running" }, context);
  const stopped = { ...run, status: "cancelled" as const, stopRequested: true };
  const stoppedControl = planControl(plan, stopped, context);

  expect(running).toMatchObject({
    canPlay: false,
    canPause: true,
    canStop: true,
    canResume: false,
  });
  expect(stoppedControl).toMatchObject({
    canPlay: true,
    canPause: false,
    canStop: false,
    canResume: false,
  });
  expect(planResumeKind(stopped)).toBeNull();
  expect(isEndedResumable(stopped)).toBe(false);
});

it("retries a rate limit but stops immediately for an invalid OpenRouter key", () => {
  expect(planBlockerClassOf("openrouter_rate_limited")).toBe("infrastructure");
  expect(planBlockerClassOf("openrouter_auth_failed")).toBe("harm");
});
