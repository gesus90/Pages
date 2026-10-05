import { useState } from "react";
import { useTranslation } from "react-i18next";

import { PanelDeleteDialog } from "@/app/components/projects/phase-plan/panel-delete-dialog";
import { PanelFields } from "@/app/components/projects/phase-plan/panel-fields";
import { PanelFooter } from "@/app/components/projects/phase-plan/panel-footer";
import { PanelHeader } from "@/app/components/projects/phase-plan/panel-header";
import { PanelLinksSection } from "@/app/components/projects/phase-plan/panel-links-section";
import { PanelMessages } from "@/app/components/projects/phase-plan/panel-messages";
import { usePanelDraft } from "@/app/components/projects/phase-plan/use-panel-draft";
import { usePanelLinks } from "@/app/components/projects/phase-plan/use-panel-links";
import { usePanelSave } from "@/app/components/projects/phase-plan/use-panel-save";
import { VerticalScrollArea } from "@/app/components/ui/vertical-scroll-area";
import { TYPE_COLORS } from "@/app/lib/phase-plan/plan-colors";
import { panelMilestoneIdFor } from "@/app/lib/phase-plan/plan-milestones";
import { WHITE_SCROLL_FADE_STYLE } from "@/app/lib/scroll-fade-style";
import { normalizeHexColorCode } from "@/definition/Task";

import type {
  LinkCandidate,
  LinkOperations,
  PanelDraft,
  PanelState,
  PlanSaveError,
  PreviewPatch,
  RevertToken,
  SavedToken,
  WorkingLink,
} from "@/app/lib/phase-plan/plan-types";
import type { CSSProperties, KeyboardEvent } from "react";

interface MilestonePanelProps {
  readonly panel: PanelState;
  readonly outgoingLinks: readonly WorkingLink[];
  readonly incomingLinkSourceIds: readonly string[];
  readonly candidates: readonly LinkCandidate[];
  readonly linkCount: number;
  readonly saveError: PlanSaveError | null;
  readonly revertToken: RevertToken | null;
  readonly savedToken: SavedToken | null;
  readonly isSaving: boolean;
  readonly isDeleting: boolean;
  readonly onSave: (
    draft: PanelDraft,
    milestoneId: string | null,
    linkOps: LinkOperations,
  ) => void;
  readonly onDelete: (milestoneId: string) => void;
  readonly onPreview: (
    milestoneId: string | null,
    patch: PreviewPatch | null,
  ) => void;
  readonly onClose: () => void;
}

const PANEL_STYLE: CSSProperties = {
  ...WHITE_SCROLL_FADE_STYLE,
  bottom: 16,
  right: 20,
  top: "6rem",
};

/** Renders the floating milestone editor overlaying the timeline. */
export function MilestonePanel(props: MilestonePanelProps): React.ReactElement {
  const { panel, saveError, revertToken, savedToken, onClose } = props;
  const { t } = useTranslation();
  const milestoneId = panelMilestoneIdFor(panel);
  const state = usePanelDraft(panel);
  const links = usePanelLinks(props.outgoingLinks, revertToken, milestoneId);
  const [showConfirm, setShowConfirm] = useState(false);
  const [popoverOpen, setPopoverOpen] = useState(false);
  const { draft } = state;
  const isDirty = state.isChanged || links.isChanged;
  const canSave =
    isDirty && state.isComplete && !state.hasRangeError && !props.isSaving;
  const draftHex =
    normalizeHexColorCode(draft.custom) ?? TYPE_COLORS[draft.color];

  const actions = usePanelSave({
    draftState: state,
    linksState: links,
    milestoneId,
    onPreview: props.onPreview,
    onSave: props.onSave,
    savedToken,
  });

  function handleKeyDown(event: KeyboardEvent<HTMLElement>): void {
    if (event.key !== "Escape") {
      return;
    }

    if (popoverOpen) {
      setPopoverOpen(false);
      return;
    }

    onClose();
  }

  function handleConfirmDelete(id: string): void {
    setShowConfirm(false);
    props.onDelete(id);
  }

  const incomingIds = new Set(props.incomingLinkSourceIds);
  const linkableCandidates = props.candidates.filter(
    (candidate) =>
      !incomingIds.has(candidate.id) &&
      !links.workingLinks.some((link) => link.targetId === candidate.id),
  );

  return (
    <aside
      className="fixed z-40 flex w-[min(28rem,calc(100vw-2.5rem))] flex-col rounded-2xl border border-border/60 bg-surface shadow-panel"
      style={PANEL_STYLE}
      aria-label={t("projectDetail.planning.phasePlan.panelTitle")}
    >
      {/* Observes Escape from the focusable controls inside; adds no layout box. */}
      <div className="contents" onKeyDown={handleKeyDown} role="presentation">
        <PanelHeader
          draft={draft}
          draftHex={draftHex}
          onClose={onClose}
          onSelectCustom={actions.selectCustomColor}
          onSelectIcon={actions.selectIcon}
          onTogglePicker={() => setPopoverOpen((isOpen) => !isOpen)}
          onClosePicker={() => setPopoverOpen(false)}
          pickerOpen={popoverOpen}
        />

        <VerticalScrollArea
          className="min-h-0 flex-1"
          contentClassName="gap-4 px-5 pt-1 pb-3"
        >
          <PanelFields state={state} />
          {milestoneId !== null ? (
            <PanelLinksSection
              candidates={linkableCandidates}
              links={links.workingLinks}
              onAdd={(target) => links.add(milestoneId, target)}
              onRemove={links.remove}
            />
          ) : null}
          <PanelMessages
            hasRangeError={state.hasRangeError}
            isDirty={isDirty}
            saveError={saveError}
          />
        </VerticalScrollArea>

        <PanelFooter
          canDelete={milestoneId !== null}
          canSave={canSave}
          onCancel={onClose}
          onDelete={() => setShowConfirm(true)}
          onSave={actions.save}
        />

        {panel.mode === "edit" ? (
          <PanelDeleteDialog
            isDeleting={props.isDeleting}
            linkCount={props.linkCount}
            milestoneName={panel.milestone.name}
            onConfirm={() => handleConfirmDelete(panel.milestone.id)}
            onOpenChange={setShowConfirm}
            open={showConfirm}
          />
        ) : null}
      </div>
    </aside>
  );
}
