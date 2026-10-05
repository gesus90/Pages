import { useState } from "react";

import type { PanelDraftState } from "@/app/components/projects/phase-plan/use-panel-draft";
import type { PanelLinksState } from "@/app/components/projects/phase-plan/use-panel-links";
import type {
  LinkOperations,
  PanelDraft,
  PreviewPatch,
  SavedToken,
  WorkingLink,
} from "@/app/lib/phase-plan/plan-types";
import type { MilestoneIcon } from "@/definition/Task";

interface Submitted {
  readonly draft: PanelDraft;
  readonly links: readonly WorkingLink[];
}

interface PanelSaveInput {
  readonly milestoneId: string | null;
  readonly draftState: PanelDraftState;
  readonly linksState: PanelLinksState;
  readonly savedToken: SavedToken | null;
  readonly onSave: (
    draft: PanelDraft,
    milestoneId: string | null,
    linkOps: LinkOperations,
  ) => void;
  readonly onPreview: (
    milestoneId: string | null,
    patch: PreviewPatch | null,
  ) => void;
}

/** What the panel does when saving and when choosing an icon or color. */
export interface PanelSave {
  readonly save: () => void;
  readonly selectIcon: (icon: MilestoneIcon) => void;
  readonly selectCustomColor: (hex: string | null) => void;
}

/**
 * Sends the draft of the panel and tracks when the save went through.
 *
 * @remarks
 * A new save token for this milestone makes the submitted draft the
 * baseline, so the panel shows no unsaved changes afterwards. A token that
 * exists already when the panel opens belongs to an earlier save and is
 * ignored. Choosing an icon or color also previews it on the timeline.
 */
export function usePanelSave(input: PanelSaveInput): PanelSave {
  const { milestoneId, draftState, linksState, savedToken } = input;
  const [submitted, setSubmitted] = useState<Submitted | null>(null);
  const [seenToken, setSeenToken] = useState(savedToken?.token ?? 0);

  if (
    savedToken !== null &&
    savedToken.milestoneId === milestoneId &&
    savedToken.token !== seenToken
  ) {
    setSeenToken(savedToken.token);

    if (submitted !== null) {
      draftState.commit(submitted.draft);
      linksState.commit(submitted.links);
      setSubmitted(null);
    }
  }

  function save(): void {
    setSubmitted({
      draft: draftState.draft,
      links: linksState.workingLinks,
    });
    input.onSave(draftState.draft, milestoneId, linksState.operations);
  }

  function preview(look: Partial<Pick<PanelDraft, "icon" | "custom">>): void {
    const next = draftState.applyLook(look);

    input.onPreview(milestoneId, {
      colorCustom: next.custom,
      colorKey: next.color,
      iconKey: next.icon,
    });
  }

  return {
    save,
    selectCustomColor: (custom) => preview({ custom }),
    selectIcon: (icon) => preview({ icon }),
  };
}
