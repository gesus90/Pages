import { useTranslation } from "react-i18next";

import { MilestonePanel } from "@/app/components/projects/phase-plan/milestone-panel";
import { PlanEmptyState } from "@/app/components/projects/phase-plan/plan-empty-state";
import { PlanLaneLabels } from "@/app/components/projects/phase-plan/plan-lane-labels";
import { PlanTimeline } from "@/app/components/projects/phase-plan/plan-timeline";
import { PlanToolbar } from "@/app/components/projects/phase-plan/plan-toolbar";
import { PlanUndatedList } from "@/app/components/projects/phase-plan/plan-undated-list";
import { usePlanEditor } from "@/app/components/projects/phase-plan/use-plan-editor";
import { usePlanViewport } from "@/app/components/projects/phase-plan/use-plan-viewport";
import {
  buildDependencyLinks,
  layoutLanes,
} from "@/app/lib/phase-plan/plan-layout";
import {
  describePanelLinks,
  panelMilestoneIdFor,
} from "@/app/lib/phase-plan/plan-milestones";
import { splitDated } from "@/app/lib/phase-plan/plan-optimistic";
import { BUFFER_MS } from "@/app/lib/phase-plan/plan-window";
import { WHITE_SCROLL_FADE_STYLE } from "@/app/lib/scroll-fade-style";

import type { Milestone, MilestoneDependency } from "@/definition/Task";

interface PhaseMilestonePlanProps {
  readonly milestones: readonly Milestone[];
  readonly milestoneLinks: readonly MilestoneDependency[];
  readonly canWrite: boolean;
}

/**
 * Renders the interactive milestone timeline for the planning tab.
 *
 * @remarks
 * The outer timeline viewport keeps a stable size in every view mode while
 * only its inner scale changes. Milestones are grouped into fixed category
 * lanes; stored dependencies render as dashed directed lines, dimmed together
 * with archived endpoints. The visible window extends on demand while
 * scrolling and rebases distant columns away, which keeps the DOM bounded
 * while the axis feels endless in both directions at a constant scroll
 * speed. Saves apply optimistically through background actions, so the
 * timeline never performs a full reload.
 */
export function PhaseMilestonePlan({
  milestones,
  milestoneLinks,
  canWrite,
}: PhaseMilestonePlanProps): React.ReactElement {
  const { t } = useTranslation();
  const editor = usePlanEditor(milestones, milestoneLinks);
  const today = Date.now();
  const { dated, undated } = splitDated(editor.milestones);
  const viewport = usePlanViewport(
    dated.map((entry) => entry.time),
    today,
  );
  const { lanes, bodyHeight } = layoutLanes({
    bufferMs: BUFFER_MS[viewport.view],
    dated,
    pixelsPerDay: viewport.pixelsPerDay,
    timeToX: viewport.timeToX,
    trackWidth: viewport.trackWidth,
  });
  const selectedId = panelMilestoneIdFor(editor.panel);
  const { panel } = editor;

  return (
    <section className="rounded-2xl bg-muted/40 p-6">
      <div>
        <h2 className="font-semibold text-foreground">
          {t("projectDetail.planning.phasePlan.title")}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("projectDetail.planning.phasePlan.subtitle")}
        </p>
      </div>

      <PlanToolbar
        canWrite={canWrite}
        onAdd={editor.openCreate}
        onReset={viewport.reset}
        onViewChange={viewport.changeView}
        view={viewport.view}
      />

      {dated.length === 0 ? (
        <PlanEmptyState />
      ) : (
        <div
          className="mt-4 overflow-hidden rounded-xl border border-border/60 bg-surface shadow-xs"
          style={WHITE_SCROLL_FADE_STYLE}
        >
          <div className="flex">
            <PlanLaneLabels lanes={lanes} onShift={viewport.shift} />
            <PlanTimeline
              bodyHeight={bodyHeight}
              links={buildDependencyLinks(editor.links, lanes)}
              lanes={lanes}
              onBackgroundClick={editor.closePanel}
              onSelect={editor.openMilestone}
              selectedId={selectedId}
              todayX={
                today >= viewport.window.start && today <= viewport.window.end
                  ? viewport.timeToX(today)
                  : null
              }
              viewport={viewport}
            />
          </div>
        </div>
      )}

      {undated.length > 0 ? (
        <PlanUndatedList
          milestones={undated}
          onSelect={editor.openMilestone}
          selectedId={selectedId}
        />
      ) : null}

      {panel !== null && canWrite ? (
        <MilestonePanel
          key={panel.mode === "edit" ? panel.milestone.id : "new"}
          {...describePanelLinks(panel, editor.milestones, editor.links)}
          isDeleting={editor.isDeleting}
          isSaving={editor.isSaving}
          onClose={editor.closePanel}
          onDelete={editor.deleteMilestone}
          onPreview={editor.previewPatch}
          onSave={editor.saveDraft}
          panel={panel}
          revertToken={editor.revertToken}
          savedToken={editor.savedToken}
          saveError={editor.saveError}
        />
      ) : null}
    </section>
  );
}
