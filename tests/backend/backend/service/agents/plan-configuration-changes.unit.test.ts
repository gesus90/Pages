import { expect, it } from "vitest";

import {
  patchPlanConfiguration,
  selectedPlanModel,
} from "@/backend/service/agents/AgentPlanConfigurationChanges";

import { partial } from "../../../app/lib/service-wiring-fakes";

import type { AgentPlanStep } from "@/definition/AgentPlan";
import type { AgentPlanChangeContext } from "@/backend/service/agents/AgentPlanStructureChanges";

const model = {
  id: "selection",
  connectionId: "connection",
  model: "new-model",
  provider: "codex_cli",
  runnerRoute: "local",
};
const context = partial<AgentPlanChangeContext>({
  agents: [],
  models: [model],
});
const step = partial<AgentPlanStep>({
  agentId: "agent",
  configuration: {
    name: "Before",
    model: "old-model",
    provider: "codex_cli",
    reasoningEffort: "high",
    template: {
      markdown: "Old",
      parameters: [],
      directoryParameter: null,
      run: {
        access: "read_only",
        shell: false,
        web: false,
        timeoutMinutes: 10,
      },
    },
  },
});

it("resolves only authorized model choices by key or connection and model", () => {
  expect(selectedPlanModel({ modelProfileId: "selection" }, context)).toEqual(
    model,
  );
  expect(
    selectedPlanModel(
      { connectionId: "connection", model: "new-model" },
      context,
    ),
  ).toEqual(model);
  expect(() =>
    selectedPlanModel(
      { connectionId: "connection", model: "unknown" },
      context,
    ),
  ).toThrow();
});

it("merges named configuration and nested run settings while retaining other fields", () => {
  expect(
    patchPlanConfiguration(
      step,
      {
        name: "After",
        modelProfileId: "selection",
        template: { markdown: "New", run: { timeoutMinutes: 20 } },
      },
      context,
    ),
  ).toMatchObject({
    name: "After",
    model: "new-model",
    connectionId: "connection",
    reasoningEffort: "high",
    template: {
      markdown: "New",
      parameters: [],
      run: { access: "read_only", timeoutMinutes: 20, shell: false },
    },
  });
});

it("rejects missing configurations, unknown fields and unselectable models", () => {
  expect(() =>
    patchPlanConfiguration(
      partial<AgentPlanStep>({ agentId: "missing" }),
      {},
      context,
    ),
  ).toThrow();
  expect(() =>
    patchPlanConfiguration(step, { unknown: true }, context),
  ).toThrow();
  expect(() =>
    patchPlanConfiguration(
      step,
      { template: { run: { unknown: true } } },
      context,
    ),
  ).toThrow();
  expect(() =>
    patchPlanConfiguration(step, { modelProfileId: "missing" }, context),
  ).toThrow();
});
