import { AgentPlanStepStart } from "@/backend/service/agents/AgentPlanStepStart";
import { AgentParameterService } from "@/backend/service/agents/AgentParameterService";
import { bindAgentParameters } from "@/backend/service/agents/AgentParameterBinding";
import { emptyAgentConfiguration } from "@/definition/AgentConfiguration";

import type { AgentConfiguration } from "@/definition/AgentConfiguration";
import type { AgentProviderId } from "@/definition/AgentConnection";
import type { AgentPlanRun } from "@/definition/AgentPlan";
import type {
  AgentPlanSnapshot,
  AgentPlanStepSnapshot,
} from "@/backend/service/agents/AgentPlanSnapshot";
import type { PreparedAgentParameters } from "@/backend/service/agents/AgentParameterService";
import type { AgentProfile } from "@/definition/AgentProfile";
import type { ResolvedAgentAssignment } from "@/backend/service/agents/AgentAssignmentResolution";

const TICKET_MARKDOWN =
  "# SYN-55\n\nFull description\n- [ ] Task\n\n## Acceptance criteria\n- [ ] Criterion: The review includes the complete description and task list.";

/** A run fixture with mocked authorization, definition files and resource reads. */
export interface ParameterRunFixture {
  readonly run: AgentPlanRun;
  readonly snapshot: AgentPlanSnapshot;
  readonly step: AgentPlanStepSnapshot;
  readonly start: AgentPlanStepStart;
  readonly parameters: AgentParameterService;
}

/**
 * Creates a full prompt path without opening a database, file or provider connection.
 *
 * @param configuration - The agent configuration, also read back as its `AGENT.md`.
 * @param provider - The provider of the agent's connection; an API provider by default.
 */
export async function parameterRunFixture(
  configuration: AgentConfiguration = emptyAgentConfiguration(),
  provider: AgentProviderId = "openrouter",
): Promise<ParameterRunFixture> {
  const prepared = await preparedParameters(configuration);
  const step: AgentPlanStepSnapshot = {
    step: {
      id: "step",
      type: "agent",
      x: 0,
      y: 0,
      agentId: "agent",
      personalAgentId: null,
      instruction: "Additional instruction",
      bindings: {},
    },
    name: "Agent",
    revision: 1,
    template: configuration,
    provider,
    model: "synthetic-free:free",
    reasoningEffort: null,
    prepared,
    taskIds: [],
    taskVersions: {},
  };
  const snapshot: AgentPlanSnapshot = {
    plan: {
      id: "plan",
      ownerId: "owner",
      name: "Plan",
      workspaceId: "workspace",
      projectId: "project",
      usage: "private",
      globals: {},
      nodes: [step.step],
      edges: [],
      revision: 1,
    },
    steps: [step],
  };
  const run: AgentPlanRun = {
    id: "run",
    planId: "plan",
    planName: "Plan",
    planRevision: 1,
    userId: "owner",
    startedAt: "2026-01-01",
    status: "running",
    stopRequested: false,
    steps: [],
  };
  const profile: AgentProfile = {
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
  };
  const assignment = fixtureAssignment(step.model, provider);
  const parameters = fixtureParameters({ profile, assignment, prepared });
  const start = new AgentPlanStepStart({
    profiles: {
      resolveDefinition: async () => ({
        profile,
        accessAgentId: "agent",
        assignment,
      }),
    },
    parameters,
    access: {
      require: async () => ({
        ...snapshot.plan,
        canEdit: true,
        projectName: "Project",
        github: null,
      }),
    },
    tasks: {
      snapshot: async () => {
        throw new Error("No task nodes in this fixture");
      },
    },
    files: {
      read: async () => ({
        path: "/synthetic/AGENT.md",
        agentId: "agent",
        revision: 1,
        configuration,
      }),
    },
  });
  return { run, snapshot, step, start, parameters };
}

function fixtureParameters(input: {
  readonly profile: AgentProfile;
  readonly assignment: ResolvedAgentAssignment;
  readonly prepared: PreparedAgentParameters;
}): AgentParameterService {
  return new AgentParameterService({
    profiles: {
      resolveDefinition: async () => ({
        profile: input.profile,
        accessAgentId: "agent",
        assignment: input.assignment,
      }),
    },
    workspaces: { resolve: async () => input.prepared.workspace },
    authorization: {
      snapshot: async () => {
        throw new Error("No wiki access in this fixture");
      },
    },
    content: {
      wiki: async () => {
        throw new Error("No wiki access in this fixture");
      },
    },
    tickets: {
      resolve: async (userId, id) => {
        if (userId !== "owner") throw new Error("Unexpected executor");
        const ticket = input.prepared.tickets?.[id];
        if (!ticket) throw new Error("Unknown synthetic ticket");
        return ticket;
      },
    },
  });
}

async function preparedParameters(
  configuration: AgentConfiguration,
): Promise<PreparedAgentParameters> {
  return {
    parameters: await bindAgentParameters(
      configuration,
      {},
      {
        workspace: async () => ({ path: "/synthetic" }),
        wiki: async () => ({ markdown: "wiki", link: "/wiki", version: "1" }),
        ticket: async () => ({
          markdown: TICKET_MARKDOWN,
          version: "1",
        }),
      },
    ),
    workspace: {
      id: "workspace",
      path: "/synthetic",
      directoryIdentity: "identity",
      revision: 1,
      projectId: "project",
      github: null,
    },
    directory: null,
    references: [],
    wiki: {},
    tickets: {
      "ticket-id": {
        markdown: TICKET_MARKDOWN,
        version: "1",
      },
    },
  };
}

function fixtureAssignment(
  model: string,
  provider: AgentProviderId,
): ResolvedAgentAssignment {
  return {
    model,
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
  };
}
