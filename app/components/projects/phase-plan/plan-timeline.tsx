import { useTranslation } from "react-i18next";

import { PlanLinksOverlay } from "@/app/components/projects/phase-plan/plan-links-overlay";
import { TimelineMilestone } from "@/app/components/projects/phase-plan/timeline-milestone";
import {
  CARD_LEVEL_STRIDE,
  LANE_PADDING,
} from "@/app/lib/phase-plan/plan-layout";

import type { PlanViewport } from "@/app/components/projects/phase-plan/use-plan-viewport";
import type {
  DependencyLink,
  LaneLayout,
  SuperSegment,
  TimelineColumn,
} from "@/app/lib/phase-plan/plan-types";
import type { Milestone } from "@/definition/Task";

interface TimelineHeaderProps {
  readonly superSegments: readonly SuperSegment[];
  readonly columns: readonly TimelineColumn[];
}

function TimelineHeader({
  superSegments,
  columns,
}: TimelineHeaderProps): React.ReactElement {
  return (
    <div className="bg-surface">
      <div className="flex h-9 border-b border-border/60">
        {superSegments.map((segment) => (
          <div
            key={segment.key}
            className="shrink-0 truncate border-l border-border/60 px-3 py-2 text-center text-xs font-semibold text-foreground first:border-l-0"
            style={{ width: `${segment.width}px` }}
          >
            {segment.label}
          </div>
        ))}
      </div>
      <div className="flex h-7 border-b border-border/60">
        {columns.map((column) => (
          <div
            key={column.key}
            className="shrink-0 truncate border-l border-border/40 px-2 py-1 text-center text-[11px] font-medium text-muted-foreground first:border-l-0"
            style={{ width: `${column.width}px` }}
          >
            {column.label}
          </div>
        ))}
      </div>
    </div>
  );
}

interface TimelineLaneProps {
  readonly lane: LaneLayout;
  readonly columns: readonly TimelineColumn[];
  readonly selectedId: string | null;
  readonly onSelect: (milestone: Milestone) => void;
}

function TimelineLane({
  lane,
  columns,
  selectedId,
  onSelect,
}: TimelineLaneProps): React.ReactElement {
  return (
    <div
      className="relative border-b border-border/40 last:border-b-0"
      style={{ height: `${lane.height}px` }}
    >
      <div className="absolute inset-0 flex" aria-hidden="true">
        {columns.map((column) => (
          <div
            key={column.key}
            className="h-full shrink-0 border-l border-border/40 first:border-l-0"
            style={{ width: `${column.width}px` }}
          />
        ))}
      </div>
      {lane.cards.map((card) => (
        <TimelineMilestone
          key={card.milestone.id}
          card={card}
          // The lane container is positioned, so the offset stays relative to
          // it; adding lane.top here would count the lane height twice.
          top={LANE_PADDING + card.level * CARD_LEVEL_STRIDE}
          isSelected={card.milestone.id === selectedId}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
}

interface TodayMarkerProps {
  readonly x: number;
  readonly trackWidth: number;
}

function TodayMarker({ x, trackWidth }: TodayMarkerProps): React.ReactElement {
  const { t } = useTranslation();

  return (
    <div
      className="pointer-events-none absolute top-0 bottom-0 z-10"
      style={{ left: 0, width: `${trackWidth}px` }}
      aria-hidden="true"
    >
      <div
        className="absolute top-0 bottom-0 border-l-2 border-dashed border-primary"
        style={{ left: `${(x / trackWidth) * 100}%` }}
      >
        <span className="absolute top-1 -translate-x-1/2 rounded-full bg-primary px-2 py-0.5 text-[10px] font-semibold whitespace-nowrap text-primary-foreground shadow-xs">
          {t("projectDetail.planning.phasePlan.today")}
        </span>
      </div>
    </div>
  );
}

interface PlanTimelineProps {
  readonly viewport: PlanViewport;
  readonly lanes: readonly LaneLayout[];
  readonly bodyHeight: number;
  readonly links: readonly DependencyLink[];
  readonly todayX: number | null;
  readonly selectedId: string | null;
  readonly onSelect: (milestone: Milestone) => void;
  readonly onBackgroundClick: () => void;
}

/** Renders the scrolling timeline with its header, lanes, links and fades. */
export function PlanTimeline({
  viewport,
  lanes,
  bodyHeight,
  links,
  todayX,
  selectedId,
  onSelect,
  onBackgroundClick,
}: PlanTimelineProps): React.ReactElement {
  const { trackWidth } = viewport;

  return (
    <div className="relative min-w-0 flex-1">
      <div
        ref={viewport.scrollRef}
        onScroll={viewport.handleScroll}
        className="pages-thin-scrollbar overflow-x-auto overscroll-contain"
      >
        <div className="w-max min-w-full" style={{ width: `${trackWidth}px` }}>
          <TimelineHeader
            columns={viewport.columns}
            superSegments={viewport.superSegments}
          />
          {/* Pointer shortcut only: keyboards close the panel with Escape or its close button. */}
          <div
            className="relative"
            onClick={onBackgroundClick}
            role="presentation"
          >
            {lanes.map((lane) => (
              <TimelineLane
                key={lane.key}
                columns={viewport.columns}
                lane={lane}
                onSelect={onSelect}
                selectedId={selectedId}
              />
            ))}
            <PlanLinksOverlay
              bodyHeight={bodyHeight}
              links={links}
              trackWidth={trackWidth}
            />
            {todayX !== null ? (
              <TodayMarker trackWidth={trackWidth} x={todayX} />
            ) : null}
          </div>
        </div>
      </div>
      <div
        aria-hidden="true"
        className={`pages-scroll-fade-start pointer-events-none absolute top-16 bottom-0 left-0 z-10 w-10 transition-opacity duration-200 ${
          viewport.hasStartFade ? "opacity-100" : "opacity-0"
        }`}
      />
      <div
        aria-hidden="true"
        className={`pages-scroll-fade-end pointer-events-none absolute top-16 right-0 bottom-0 z-10 w-10 transition-opacity duration-200 ${
          viewport.hasEndFade ? "opacity-100" : "opacity-0"
        }`}
      />
    </div>
  );
}
