import { useState } from "react";

import {
  blankPanelDraft,
  toPanelDraft,
} from "@/app/lib/phase-plan/plan-milestones";

import type { PanelDraft, PanelState } from "@/app/lib/phase-plan/plan-types";

/** The text and choice fields the panel edits directly. */
type DraftField = "name" | "start" | "end" | "description" | "status";

/** The draft of the milestone panel together with what it started from. */
export interface PanelDraftState {
  readonly draft: PanelDraft;
  readonly baseline: PanelDraft;
  /** Whether any field differs from the baseline. */
  readonly isChanged: boolean;
  readonly hasRangeError: boolean;
  /** Whether the draft has what a milestone needs: a name and a start date. */
  readonly isComplete: boolean;
  readonly setField: <Field extends DraftField>(
    field: Field,
    value: PanelDraft[Field],
  ) => void;
  /** Replaces the icon and color fields, which the picker chooses together. */
  readonly applyLook: (
    look: Partial<Pick<PanelDraft, "icon" | "custom">>,
  ) => PanelDraft;
  /** Takes a saved draft as the new baseline. */
  readonly commit: (saved: PanelDraft) => void;
}

function startingDraft(panel: PanelState): PanelDraft {
  return panel.mode === "edit"
    ? toPanelDraft(panel.milestone)
    : blankPanelDraft(Date.now());
}

/**
 * Keeps the draft of the milestone panel and tells whether it changed.
 *
 * @param panel - What the panel edits; the draft starts from it.
 */
export function usePanelDraft(panel: PanelState): PanelDraftState {
  const [baseline, setBaseline] = useState<PanelDraft>(() =>
    startingDraft(panel),
  );
  const [draft, setDraft] = useState<PanelDraft>(() => startingDraft(panel));

  function setField<Field extends DraftField>(
    field: Field,
    value: PanelDraft[Field],
  ): void {
    setDraft((current) => ({ ...current, [field]: value }));
  }

  function applyLook(
    look: Partial<Pick<PanelDraft, "icon" | "custom">>,
  ): PanelDraft {
    const next = { ...draft, ...look };

    setDraft(next);

    return next;
  }

  return {
    applyLook,
    baseline,
    commit: setBaseline,
    draft,
    hasRangeError:
      draft.start !== "" && draft.end !== "" && draft.end < draft.start,
    isChanged:
      draft.name.trim() !== baseline.name.trim() ||
      draft.start !== baseline.start ||
      draft.end !== baseline.end ||
      draft.description.trim() !== baseline.description.trim() ||
      draft.color !== baseline.color ||
      draft.custom !== baseline.custom ||
      draft.icon !== baseline.icon ||
      draft.status !== baseline.status,
    isComplete: draft.name.trim() !== "" && draft.start !== "",
    setField,
  };
}
