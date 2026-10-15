import { vi } from "vitest";

import { AgentPlanPreparation } from "@/backend/service/agents/AgentPlanPreparation";
import { AgentParameterService } from "@/backend/service/agents/AgentParameterService";
import { AgentPlanStepStart } from "@/backend/service/agents/AgentPlanStepStart";
import { copyPlanConfiguration } from "@/definition/AgentPlanConfiguration";
import { emptyAgentConfiguration } from "@/definition/AgentConfiguration";

import { PageAgentWorld } from "./page-agent-world";

import type { AgentDefinitionSelection } from "@/definition/AgentAvailability";
import type { AgentPlan } from "@/definition/AgentPlan";
import type { PageAgentInput } from "@/definition/PageAgent";

/** Template X/M/R with an independent numeric runtime default. */
export function templateInput(): PageAgentInput {
  return {
    name: "Template A",
    modelProfileId: "model-a",
    reasoningEffort: "low",
    configuration: {
      ...emptyAgentConfiguration(),
      markdown: "X {{count}}",
      parameters: [
        {
          name: "count",
          type: "number",
          description: "",
          isRequired: true,
          defaultValue: { type: "number", number: 7 },
        },
      ],
    },
  };
}

/** Production services over in-memory repository, filesystem and workspace boundaries. */
export async function templateFixture(): Promise<{
  readonly world: PageAgentWorld;
  readonly agentId: string;
  readonly plan: AgentPlan;
  readonly preparation: AgentPlanPreparation;
  readonly start: AgentPlanStepStart;
}> {
  const world = new PageAgentWorld();
  world.addPerson("owner");
  world.addPerson("other");
  world.addModel("model-a", { efforts: ["low", "high"] });
  world.addModel("model-b", { efforts: ["low", "high"] });
  const agentId = await world.agents.save("owner", null, templateInput());
  const source = (await world.administration.catalog("owner")).find(
    (entry) => entry.id === agentId,
  );
  if (!source) throw new Error("Missing template");
  const plan: AgentPlan = {
    id: "plan",
    name: "Independent nodes",
    ownerId: "owner",
    projectId: "project",
    workspaceId: "workspace",
    usage: "private",
    globals: {},
    revision: 1,
    nodes: [
      { id: "start", type: "start", x: 0, y: 0 },
      {
        id: "node",
        type: "agent",
        x: 320,
        y: 0,
        agentId,
        personalAgentId: null,
        instruction: "Additional",
        bindings: {},
        configuration: copyPlanConfiguration(source),
      },
      { id: "end", type: "end", x: 640, y: 0 },
    ],
    edges: [
      { from: "start", to: "node", fromPort: "flow-out", toPort: "flow-in" },
      { from: "node", to: "end", fromPort: "flow-out", toPort: "flow-in" },
    ],
  };
  // Project membership is a mocked external boundary; model and template policy remain real.
  const profiles = {
    catalog: async () => world.administration.catalog("owner"),
    resolveDefinition: async (
      userId: string,
      selection: AgentDefinitionSelection,
    ) =>
      world.administration.resolveDefinition(userId, {
        ...selection,
        projectId: null,
      }),
  };
  const parameters = new AgentParameterService({
    profiles,
    workspaces: {
      resolve: async () => ({
        id: "workspace",
        projectId: "project",
        path: "/synthetic",
        directoryIdentity: "identity",
        revision: 1,
        github: null,
      }),
    },
    authorization: { snapshot: async () => world.snapshot() },
    content: { wiki: vi.fn() },
  });
  const tasks = { snapshot: vi.fn() };
  const preparation = new AgentPlanPreparation({ profiles, parameters, tasks });
  const start = new AgentPlanStepStart({
    profiles,
    parameters,
    tasks,
    access: {
      require: async () => ({
        ...plan,
        canEdit: true,
        projectName: "Project",
        github: null,
      }),
    },
    files: world.files,
  });
  return { world, agentId, plan, preparation, start };
}
