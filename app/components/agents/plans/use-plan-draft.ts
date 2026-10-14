import { useEffect, useRef, useState } from "react";

import { emptyAgentPlan } from "@/definition/AgentPlan";

import type { AgentPlanActionResult } from "@/app/lib/agent-plan-response";
import type { AgentPlanInput, AgentPlanPage } from "@/definition/AgentPlan";

function initialDraft(page: AgentPlanPage): AgentPlanInput {
  const plan = page.selected;
  if (!plan) return emptyAgentPlan();
  return {
    name: plan.name,
    workspaceId: plan.workspaceId,
    projectId: plan.projectId,
    usage: plan.usage,
    sharing: plan.sharing,
    globals: plan.globals,
    nodes: plan.nodes,
    edges: plan.edges,
    revision: plan.revision,
  };
}

function contents(draft: AgentPlanInput): string {
  return JSON.stringify({ ...draft, revision: undefined });
}

/** The revision a finished save or start stored the submitted draft as, or `null`. */
function storedRevision(
  result: AgentPlanActionResult | undefined,
  isPending: boolean,
): number | null {
  if (isPending || !result?.ok || result.revision === undefined) return null;
  return result.intent === "save-plan" || result.intent === "play-plan"
    ? result.revision
    : null;
}

/** Revalidation never discards local edits; only an acknowledged save or start advances the draft revision. */
export function usePlanDraft(
  page: AgentPlanPage,
  result: AgentPlanActionResult | undefined,
  isPending: boolean,
): {
  readonly draft: AgentPlanInput;
  readonly setDraft: React.Dispatch<React.SetStateAction<AgentPlanInput>>;
  readonly isDirty: boolean;
  readonly submitted: React.RefObject<AgentPlanInput | null>;
} {
  const [draft, setDraft] = useState(() => initialDraft(page));
  const [saved, setSaved] = useState(() => initialDraft(page));
  const submitted = useRef<AgentPlanInput | null>(null);
  const acknowledged =
    storedRevision(result, isPending) === null ? null : submitted.current;
  const isDirty = contents(draft) !== contents(acknowledged ?? saved);
  useEffect(() => {
    const revision = storedRevision(result, isPending);
    if (revision === null || !submitted.current) return;
    const snapshot = submitted.current;
    const persisted = { ...snapshot, revision };
    setSaved(persisted);
    // Edits made while the request ran stay unsaved on top of the stored revision.
    setDraft((previous) =>
      contents(previous) === contents(snapshot)
        ? persisted
        : { ...previous, revision },
    );
  }, [result, isPending]);
  return { draft, setDraft, isDirty, submitted };
}
