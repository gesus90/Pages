import { useCallback, useEffect, useRef, useState } from "react";

import { emptyAgentPlan } from "@/definition/AgentPlan";

import type { AgentPlanActionResult } from "@/app/lib/agent-plan-response";
import type { AgentPlanInput, AgentPlanPage } from "@/definition/AgentPlan";
import type { Dispatch, SetStateAction } from "react";

function initialDraft(page: AgentPlanPage): AgentPlanInput {
  const plan = page.selected;
  if (!plan) return emptyAgentPlan();
  return {
    name: plan.name,
    workspaceId: plan.workspaceId,
    projectId: plan.projectId,
    usage: plan.usage,
    sharing: plan.sharing,
    ...(plan.executionTarget ? { executionTarget: plan.executionTarget } : {}),
    globals: plan.globals,
    nodes: plan.nodes,
    edges: plan.edges,
    revision: plan.revision,
  };
}

// A draft is replaced, never changed, so its text stays valid for its lifetime.
const serialized = new WeakMap<AgentPlanInput, string>();

/**
 * The text that tells two drafts apart, without their revision.
 *
 * @remarks
 * Every render compares the draft with the stored plan. Serializing a large
 * plan each time made typing and dragging wait for `JSON.stringify`, so the
 * text is made once per draft object.
 */
export function planDraftContents(draft: AgentPlanInput): string {
  const known = serialized.get(draft);
  if (known !== undefined) return known;
  const text = JSON.stringify({ ...draft, revision: undefined });
  serialized.set(draft, text);
  return text;
}

/** The revision a finished save or start stored the submitted draft as, or `null`. */
function storedRevision(
  result: AgentPlanActionResult | undefined,
  isSubmitting: boolean,
): number | null {
  if (isSubmitting || !result?.ok || result.revision === undefined) return null;
  return result.intent === "save-plan" || result.intent === "play-plan"
    ? result.revision
    : null;
}

/**
 * Revalidation never discards local edits; only an acknowledged save or start advances the draft revision.
 *
 * @remarks
 * `isSubmitting` is true while the request itself is on its way. The reload of
 * the page data that follows does not delay the acknowledgement: the stored
 * revision is known as soon as the server answered.
 */
export function usePlanDraft(
  page: AgentPlanPage,
  result: AgentPlanActionResult | undefined,
  isSubmitting: boolean,
): {
  readonly draft: AgentPlanInput;
  readonly setDraft: Dispatch<SetStateAction<AgentPlanInput>>;
  /** The latest queued edits, even before React renders them. */
  readonly currentDraft: () => AgentPlanInput;
  readonly isDirty: boolean;
  readonly submitted: React.RefObject<AgentPlanInput | null>;
} {
  const [draft, commitDraft] = useState(() => initialDraft(page));
  const current = useRef(draft);
  const setDraft = useCallback(
    (change: SetStateAction<AgentPlanInput>): void => {
      const next =
        typeof change === "function" ? change(current.current) : change;
      current.current = next;
      commitDraft(next);
    },
    [],
  );
  const currentDraft = useCallback(() => current.current, []);
  const [saved, setSaved] = useState(() => initialDraft(page));
  const submitted = useRef<AgentPlanInput | null>(null);
  const acknowledged =
    storedRevision(result, isSubmitting) === null ? null : submitted.current;
  const isDirty =
    planDraftContents(draft) !== planDraftContents(acknowledged ?? saved);
  useEffect(() => {
    const revision = storedRevision(result, isSubmitting);
    if (revision === null || !submitted.current) return;
    const snapshot = submitted.current;
    const persisted = { ...snapshot, revision };
    setSaved(persisted);
    // Edits made while the request ran stay unsaved on top of the stored revision.
    setDraft((previous) =>
      planDraftContents(previous) === planDraftContents(snapshot)
        ? persisted
        : { ...previous, revision },
    );
  }, [result, isSubmitting, setDraft]);
  return { draft, setDraft, currentDraft, isDirty, submitted };
}
