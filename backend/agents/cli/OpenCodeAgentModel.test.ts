import { expect, it, vi } from "vitest";

import {
  describeOpenCodeAgent,
  isOpenCodeApiAgent,
  openCodeAgentModel,
  openCodeAgentObserver,
} from "@/backend/agents/cli/OpenCodeAgentModel";

import type {
  AgentPlanSessionInput,
  PlanSessionObserver,
} from "@/backend/agents/AgentPlanExecution";

/** Casts a partial stand-in to the type the code under test expects. */
function fake<T>(value: object): T {
  return value as T;
}

function sessionInput(provider: string): AgentPlanSessionInput {
  return fake<AgentPlanSessionInput>({
    agent: { connection: { provider }, model: "vendor/model" },
  });
}

it("recognizes only OpenRouter as the OpenCode API agent", () => {
  expect(isOpenCodeApiAgent("openrouter")).toBe(true);
  expect(isOpenCodeApiAgent("opencode")).toBe(false);
});

it("adds the runtime provider prefix only for OpenRouter", () => {
  expect(openCodeAgentModel(sessionInput("openrouter"))).toBe(
    "openrouter/vendor/model",
  );
  expect(openCodeAgentModel(sessionInput("opencode"))).toBe("vendor/model");
});

it("presents diagnostics under the selected connection", () => {
  expect(
    describeOpenCodeAgent(
      sessionInput("openrouter"),
      "OpenCode ran openrouter/vendor/model",
    ),
  ).toBe("OpenRouter ran vendor/model");
  expect(describeOpenCodeAgent(sessionInput("opencode"), "OpenCode")).toBe(
    "OpenCode",
  );
});

it("keeps the observer of a non-OpenRouter session", () => {
  const observer = fake<PlanSessionObserver>({});
  expect(openCodeAgentObserver(sessionInput("opencode"), observer)).toBe(
    observer,
  );
});

it("relabels the adapter an OpenRouter session reports", () => {
  const capabilities = vi.fn();
  const observer = fake<PlanSessionObserver>({ capabilities });
  const wrapped = openCodeAgentObserver(sessionInput("openrouter"), observer);
  wrapped.capabilities?.(
    fake<Parameters<NonNullable<PlanSessionObserver["capabilities"]>>[0]>({
      adapter: "OpenCode 1",
      other: true,
    }),
  );
  expect(capabilities).toHaveBeenCalledWith({
    adapter: "OpenRouter 1",
    other: true,
  });
  const silent = openCodeAgentObserver(
    sessionInput("openrouter"),
    fake<PlanSessionObserver>({}),
  );
  expect(
    silent.capabilities?.(
      fake<Parameters<NonNullable<PlanSessionObserver["capabilities"]>>[0]>({
        adapter: "OpenCode",
      }),
    ),
  ).toBeUndefined();
});
