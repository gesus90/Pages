import { emptyAgentConfiguration } from "@/definition/AgentConfiguration";
import { emptyAgentPlan } from "@/definition/AgentPlan";

import type { AgentDefinitionChoice } from "@/definition/AgentAvailability";
import type {
  AgentPlanPage,
  AgentPlanRun,
  AgentPlanStep,
} from "@/definition/AgentPlan";

/** A shared component/browser fixture contains public catalog metadata only. */
export function planUiPage(): AgentPlanPage {
  const configuration = {
    ...emptyAgentConfiguration("system"),
    markdown: "{{input}}",
    parameters: [
      {
        name: "input",
        type: "text",
        isRequired: true,
        description: "Task",
        defaultValue: null,
      },
    ],
  } as const;
  const worker: AgentDefinitionChoice = {
    id: "worker",
    name: "Worker",
    provider: "openrouter",
    model: "model-a",
    reasoningEffort: null,
    revision: 1,
    purposes: ["agent"],
    configuration,
    availability: { isUsable: true, reason: null, personalChoices: [] },
  };
  const workspace = {
    id: "workspace",
    name: "Development",
    projectId: "project",
    projectName: "Project",
    path: "/approved/copy",
    github: null,
    isUsable: true,
    reason: null,
  } as const;
  const selected = {
    ...emptyAgentPlan(),
    id: "plan",
    name: "Build",
    workspaceId: workspace.id,
    ownerId: "bob",
    projectId: "project",
    projectName: "Project",
    github: null,
    revision: 1,
    canEdit: true,
  };
  return {
    userId: "bob",
    plans: [selected],
    selected,
    workspaces: [workspace],
    runs: [],
    sources: {
      agents: [worker],
      tasks: [
        {
          id: "task",
          key: "P-1",
          title: "Implement",
          type: "task",
          parentId: "epic",
          statusName: "Open",
        },
      ],
    },
  };
}

/** Fixed node IDs make binding/removal assertions readable across editor tests. */
export function planUiStep(id = "A"): AgentPlanStep {
  return {
    id,
    type: "agent",
    agentId: "worker",
    personalAgentId: null,
    instruction: "",
    x: 20,
    y: 20,
    bindings: {},
  };
}

/** Public progress fixture supports polling without executing providers. */
export function planUiRun(): AgentPlanRun {
  return {
    id: "run",
    planId: "plan",
    planName: "Build",
    planRevision: 1,
    userId: "bob",
    startedAt: "2026-10-11T14:00:00Z",
    status: "running",
    stopRequested: false,
    steps: [
      {
        id: "A",
        name: "Worker",
        status: "running",
        cancellation: "none",
        isBlocked: false,
        output: null,
        error: null,
      },
    ],
  };
}
