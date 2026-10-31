import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { useFetcher } from "react-router";

import { readPlanConfiguration } from "@/backend/agents/AgentPlanConfigurationInput";

import { usePlanDraft } from "./use-plan-draft";
import { usePlanGraph } from "./use-plan-graph";
import { usePlanSources } from "./use-plan-sources";
import { isSaveCommand, usePlanSubmission } from "./use-plan-submission";

import type { AgentWorkspaceChoice } from "@/definition/AgentWorkspace";
import type { AgentPlanActionResult } from "@/app/lib/agent-plan-response";
import type {
  AgentPlanInput,
  AgentPlanPage,
  AgentPlanSources,
} from "@/definition/AgentPlan";
import type { AgentPlanConfiguration } from "@/definition/AgentPlanConfiguration";
import type { PlanTicketRefresh } from "./use-plan-ticket-refresh";

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
  readonly workspaces: readonly AgentWorkspaceChoice[];
  readonly sources: AgentPlanSources;
  readonly graph: ReturnType<typeof usePlanGraph>;
  readonly command: ReturnType<typeof useFetcher<AgentPlanActionResult>>;
  readonly isDirty: boolean;
  readonly canEdit: boolean;
  /**
   * Whether a command or the sources of a new workspace are on their way.
   *
   * @remarks
   * The reload of the page data after a stored save does not count: the save
   * is answered by then and the person keeps working.
   */
  readonly isPending: boolean;
  /** Whether a save request is on its way and not yet answered. */
  readonly isSaving: boolean;
  readonly isLoadingSources: boolean;
  readonly sourceError: string | null;
  readonly tickets: PlanTicketRefresh;
  /** The plan name the last save carried; `null` before any save. */
  readonly submittedName: string | null;
  /** Whether the person asked for the last save with the save button or Ctrl+S, not through a dialog. */
  readonly isExplicitSave: boolean;
  readonly save: () => void;
  /** Applies a change to the draft and saves the result in the same step. */
  readonly saveWith: (
    change: (draft: AgentPlanInput) => AgentPlanInput,
  ) => void;
  readonly rename: (name: string) => void;
  readonly changeContext: (workspace: AgentWorkspaceChoice) => void;
} {
  const command = useFetcher<AgentPlanActionResult>();
  const navigate = useNavigate();
  const [submittedName, setSubmittedName] = useState<string | null>(null);
  useEffect(() => {
    if (!page.selected && command.data?.ok && command.data.planId)
      void navigate(
        `/agents/plans?planId=${encodeURIComponent(command.data.planId)}`,
      );
  }, [command.data, page.selected, navigate]);
  const isSubmitting = command.state === "submitting";
  const { draft, setDraft, currentDraft, isDirty, submitted } = usePlanDraft(
    page,
    command.data,
    isSubmitting,
  );
  const [isExplicitSave, setExplicitSave] = useState(false);
  const submitSave = usePlanSubmission({
    command,
    planId: page.selected?.id ?? "",
    currentDraft,
    submitted,
  });
  const sourceState = usePlanSources(page, draft.workspaceId);
  const { sources } = sourceState;
  function changeContext(workspace: AgentWorkspaceChoice): void {
    setDraft((previous) => ({
      ...previous,
      workspaceId: workspace.id,
      projectId: workspace.projectId,
    }));
  }
  const graph = usePlanGraph(draft, setDraft, sources, {
    loadConfiguration: (agentId) =>
      loadNodeConfiguration(draft.workspaceId, agentId),
    currentDraft,
  });
  function requestSave(
    change: (current: AgentPlanInput) => AgentPlanInput,
    isExplicit: boolean,
  ): void {
    graph.flushPendingMove();
    const current = currentDraft();
    const next = change(current);
    if (next !== current) setDraft(next);
    setExplicitSave(isExplicit);
    setSubmittedName(next.name);
    submitSave(next);
  }
  // A save asked for while one runs waits for its answer instead of being dropped.
  function saveWith(change: (current: AgentPlanInput) => AgentPlanInput): void {
    requestSave(change, false);
  }
  const isSaving = isSubmitting && isSaveCommand(command);
  const isRevalidatingSave =
    command.state === "loading" && isSaveCommand(command);
  return {
    draft,
    workspaces: page.workspaces,
    sources,
    graph,
    command,
    isDirty,
    canEdit: page.selected?.canEdit ?? true,
    isPending:
      (command.state !== "idle" && !isRevalidatingSave) ||
      sourceState.isPending,
    isSaving,
    isLoadingSources: sourceState.isPending,
    sourceError: sourceState.error,
    tickets: sourceState.tickets,
    submittedName,
    isExplicitSave,
    save: () => requestSave((current) => current, true),
    saveWith,
    rename: (name) => setDraft((previous) => ({ ...previous, name })),
    changeContext,
  };
}
