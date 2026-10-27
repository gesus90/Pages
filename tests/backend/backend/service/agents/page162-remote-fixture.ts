import { defaultAgentRunOptions } from "@/definition/AgentConfiguration";

import type { AgentPlanStep } from "@/definition/AgentPlan";
import type { RemotePlanParameters } from "@/backend/service/agents/AgentPlanRemoteParameters";

/** A remote CLI selection with no provider, transport, process or workspace access. */
export function remoteTodoStep(): AgentPlanStep {
  return {
    id: "agent",
    type: "agent",
    agentId: "",
    personalAgentId: null,
    instruction: "Implement the bound ticket",
    completion: "todos",
    bindings: {},
    x: 0,
    y: 0,
    configuration: {
      name: "Synthetic remote CLI",
      revision: 1,
      modelProfileId: "synthetic",
      model: "synthetic",
      provider: "codex_cli",
      reasoningEffort: null,
      runnerRoute: {
        connectionId: "00000000-0000-4000-8000-000000000001",
        workspaceId: "00000000-0000-4000-8000-000000000002",
        catalogRevision: "synthetic",
        tool: "codex",
      },
      template: {
        markdown: "Use the bound ticket.",
        parameters: [],
        directoryParameter: null,
        run: defaultAgentRunOptions("codex_cli"),
      },
    },
  };
}

/** A private remote ticket binding, deliberately retaining stale source Markdown. */
export function remoteTodoParameters(): RemotePlanParameters {
  return {
    values: { ticket: { type: "ticket", ticketId: "ticket" } },
    tickets: {
      ticket: {
        id: "ticket",
        key: "SYN-ticket",
        title: "Synthetic work",
        description: "Stale empty planning snapshot",
        markdown: "Stale empty planning snapshot",
        assets: [],
        version: "old-version",
      },
    },
    wiki: {},
    workspaces: {},
    resources: [],
    assets: [],
  };
}
