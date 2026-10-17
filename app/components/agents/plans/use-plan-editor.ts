import { useFetcher } from "react-router";

import { readPlanConfiguration } from "@/backend/agents/AgentPlanConfigurationInput";

import { usePlanDraft } from "./use-plan-draft";
import { usePlanGraph } from "./use-plan-graph";

import type { AgentPlanActionResult } from "@/app/lib/agent-plan-response";
import type {
  AgentPlanInput,
  AgentPlanPage,
  AgentPlanSources,
} from "@/definition/AgentPlan";
import type { AgentPlanConfiguration } from "@/definition/AgentPlanConfiguration";

async function loadNodeConfiguration(
  workspaceId: string,
  agentId: string,
): Promise<AgentPlanConfiguration> {
  const query = new URLSearchParams({ workspaceId, agentId });
  const response = await fetch(`/agent-api/plan-sources?${query}`, {
    cache: "no-store",
  });
  if (!response.ok) throw new Error("Agent template unavailable");
  const configuration: unknown = await response.json();
  return readPlanConfiguration(configuration);
}

/** Saved graphs and unsaved edits remain separate state; only an explicit save stores the draft. */
export function usePlanEditor(page: AgentPlanPage): {
  readonly draft: AgentPlanInput;
  readonly sources: AgentPlanSources;
  readonly graph: ReturnType<typeof usePlanGraph>;
  readonly command: ReturnType<typeof useFetcher<AgentPlanActionResult>>;
  readonly isDirty: boolean;
  readonly canEdit: boolean;
  readonly isPending: boolean;
  readonly save: () => void;
} {
  const command = useFetcher<AgentPlanActionResult>();
  const { draft, setDraft, isDirty, submitted } = usePlanDraft(
    page,
    command.data,
    command.state !== "idle",
  );
  const sources = page.sources;
  const graph = usePlanGraph(draft, setDraft, sources, (agentId) =>
    loadNodeConfiguration(draft.workspaceId, agentId),
  );
  // Flushing the pending state ignores a second save until the first one answered.
  function save(): void {
    submitted.current = draft;
    void command.submit(
      {
        intent: "save-plan",
        planId: page.selected?.id ?? "",
        plan: JSON.stringify(draft),
      },
      { method: "post", action: "/agents/plans", flushSync: true },
    );
  }
  return {
    draft,
    sources,
    graph,
    command,
    isDirty,
    canEdit: page.selected?.canEdit ?? true,
    isPending: command.state !== "idle",
    save,
  };
}
