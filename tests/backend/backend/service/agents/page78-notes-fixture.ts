import { vi } from "vitest";

import {
  acpRunOptions,
  emptyAgentConfiguration,
} from "@/definition/AgentConfiguration";
import { AgentPlanStepStart } from "@/backend/service/agents/AgentPlanStepStart";

import { parameterRunFixture } from "./page55-run-fixture";

import type { AgentProviderId } from "@/definition/AgentConnection";
import type { ParameterRunFixture } from "./page55-run-fixture";

/** An authorized frozen CLI node, with resource and definition boundaries replaced. */
export async function notesRunFixture(
  provider: AgentProviderId = "codex_cli",
  markdown = "Notes: {{@run.notes}}",
): Promise<ParameterRunFixture> {
  const base = await parameterRunFixture(emptyAgentConfiguration(), provider);
  const configuration = {
    ...emptyAgentConfiguration(),
    markdown,
    run: acpRunOptions("yolo", 0),
  };
  const step = { ...base.step, template: configuration };
  return {
    ...base,
    step,
    snapshot: { ...base.snapshot, steps: [step] },
    start: new AgentPlanStepStart({
      parameters: base.parameters,
      access: { require: vi.fn() },
      tasks: { snapshot: vi.fn() },
      profiles: {
        resolveDefinition: async () => ({
          accessAgentId: "agent",
          profile: {
            id: "agent",
            name: "Agent",
            connectionId: "connection",
            model: step.model,
            reasoningEffort: null,
            isActive: true,
            purposes: ["agent"],
            targets: [],
            configuration,
            revision: 1,
          },
          assignment: {
            model: step.model,
            reasoningEffort: null,
            connection: {
              id: "connection",
              name: "Connection",
              provider,
              isActive: true,
              hasApiKey: true,
              testModel: null,
              reasoningEffort: null,
              cliLoggedInAt: null,
              cliAccountLabel: null,
              updatedAt: "2026-01-01",
            },
          },
        }),
      },
    }),
  };
}
