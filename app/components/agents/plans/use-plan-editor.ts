import { useEffect, useRef, useState } from "react";
import { useFetcher, useNavigate } from "react-router";

import { emptyAgentPlan } from "@/definition/AgentPlan";

import { usePlanGraph } from "./use-plan-graph";

import type { AgentPlanActionResult } from "@/app/lib/agent-plan-response";
import type {
  AgentPlanInput,
  AgentPlanPage,
  AgentPlanSources,
} from "@/definition/AgentPlan";

/** Source responses carry their workspace so delayed responses cannot cross project selections. */
export type PlanSourceResponse =
  | { readonly workspaceId: string; readonly sources: AgentPlanSources }
  | { readonly ok: false; readonly error: string };

function initialDraft(page: AgentPlanPage): AgentPlanInput {
  const plan = page.selected;
  if (!plan) return emptyAgentPlan();
  return {
    name: plan.name,
    workspaceId: plan.workspaceId,
    usage: plan.usage,
    globals: plan.globals,
    nodes: plan.nodes,
    edges: plan.edges,
    revision: plan.revision,
  };
}

function hasSavedDraft(
  result: AgentPlanActionResult | undefined,
  isPending: boolean,
): boolean {
  return !isPending && result?.ok === true && result.intent === "save-plan";
}

/** Keeps editable graph state separate from saved plans and immutable execution views. */
export function usePlanEditor(page: AgentPlanPage): {
  readonly draft: AgentPlanInput;
  readonly setDraft: React.Dispatch<React.SetStateAction<AgentPlanInput>>;
  readonly sources: AgentPlanSources;
  readonly graph: ReturnType<typeof usePlanGraph>;
  readonly command: ReturnType<typeof useFetcher<AgentPlanActionResult>>;
  readonly isDirty: boolean;
  readonly canEdit: boolean;
  readonly isPending: boolean;
  readonly sourceError: string | null;
  readonly save: () => void;
  readonly play: () => void;
  readonly stop: (id: string) => void;
} {
  const [draft, setDraft] = useState<AgentPlanInput>(() => initialDraft(page));
  const command = useFetcher<AgentPlanActionResult>();
  const sourceRequest = useFetcher<PlanSourceResponse>();
  const { load: loadSources } = sourceRequest;
  const submittedDraft = useRef<string | null>(null);
  const navigate = useNavigate();
  const response = sourceRequest.data;
  const canEdit = page.selected?.canEdit ?? true;
  const isPending = command.state !== "idle";
  const hasSaved = hasSavedDraft(command.data, isPending);
  const isDirty =
    JSON.stringify(draft) !==
    (hasSaved ? submittedDraft.current : JSON.stringify(initialDraft(page)));
  let sources = page.sources;
  if (draft.workspaceId !== page.selected?.workspaceId)
    sources = { agents: [], tasks: [] };
  if (
    response &&
    "sources" in response &&
    response.workspaceId === draft.workspaceId
  )
    sources = response.sources;
  const graph = usePlanGraph(draft, setDraft, sources);
  useEffect(() => {
    if (draft.workspaceId && draft.workspaceId !== page.selected?.workspaceId)
      void loadSources(
        `/agent-api/plan-sources?workspaceId=${encodeURIComponent(draft.workspaceId)}`,
      );
  }, [draft.workspaceId, page.selected?.workspaceId, loadSources]);
  useEffect(() => {
    const result = command.data;
    if (
      result?.ok &&
      result.intent === "save-plan" &&
      result.planId &&
      result.planId !== page.selected?.id
    )
      void navigate(
        `/agents/plans?planId=${encodeURIComponent(result.planId)}`,
      );
  }, [command.data, page.selected?.id, navigate]);
  function save(): void {
    submittedDraft.current = JSON.stringify(draft);
    void command.submit(
      {
        intent: "save-plan",
        planId: page.selected?.id ?? "",
        plan: JSON.stringify(draft),
      },
      { method: "post", action: "/agents/plans" },
    );
  }
  function play(): void {
    if (!page.selected || isDirty) return;
    void command.submit(
      {
        intent: "play-plan",
        planId: page.selected.id,
        revision: String(page.selected.revision),
      },
      { method: "post", action: "/agents/plans" },
    );
  }
  function stop(id: string): void {
    void command.submit(
      { intent: "stop-plan", runId: id },
      { method: "post", action: "/agents/plans" },
    );
  }
  return {
    draft,
    setDraft,
    sources,
    graph,
    command,
    isDirty,
    canEdit,
    isPending,
    sourceError: response && "error" in response ? response.error : null,
    save,
    play,
    stop,
  };
}
