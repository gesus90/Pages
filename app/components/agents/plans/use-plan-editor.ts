import { useEffect } from "react";
import { useFetcher, useNavigate } from "react-router";

import { usePlanDraft } from "./use-plan-draft";
import { usePlanGraph } from "./use-plan-graph";
import { usePlanSources } from "./use-plan-sources";

import type { AgentPlanActionResult } from "@/app/lib/agent-plan-response";
import type {
  AgentPlanInput,
  AgentPlanPage,
  AgentPlanSources,
} from "@/definition/AgentPlan";

/** Saved graphs, unsaved edits and immutable run commands remain separate state; Play saves unsaved edits first. */
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
  readonly pause: (id: string) => void;
  readonly resume: (id: string) => void;
} {
  const command = useFetcher<AgentPlanActionResult>();
  const { draft, setDraft, isDirty, submitted } = usePlanDraft(
    page,
    command.data,
    command.state !== "idle",
  );
  const { sources, sourceError } = usePlanSources(page, draft.workspaceId);
  const graph = usePlanGraph(draft, setDraft, sources);
  const navigate = useNavigate();
  useEffect(() => {
    const result = command.data;
    if (
      result?.ok &&
      command.state === "idle" &&
      !isDirty &&
      result.intent === "save-plan" &&
      result.planId &&
      result.planId !== page.selected?.id
    )
      void navigate(
        `/agents/plans?planId=${encodeURIComponent(result.planId)}`,
      );
  }, [command.data, command.state, isDirty, page.selected?.id, navigate]);
  // Flushing the pending state disables the buttons before a second click can submit again.
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
  function play(): void {
    if (!page.selected) return;
    submitted.current = draft;
    const version: Readonly<Record<string, string>> = isDirty
      ? { plan: JSON.stringify(draft) }
      : { revision: String(draft.revision) };
    void command.submit(
      { intent: "play-plan", planId: page.selected.id, ...version },
      { method: "post", action: "/agents/plans", flushSync: true },
    );
  }
  function control(intent: string, id: string): void {
    void command.submit(
      { intent, runId: id },
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
    canEdit: page.selected?.canEdit ?? true,
    isPending: command.state !== "idle",
    sourceError,
    save,
    play,
    stop: (id) => control("stop-plan", id),
    pause: (id) => control("pause-plan", id),
    resume: (id) => control("resume-plan", id),
  };
}
