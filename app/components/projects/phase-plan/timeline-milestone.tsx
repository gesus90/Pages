import { Calendar } from "lucide-react";
import { useTranslation } from "react-i18next";

import { MilestoneMarkerIcon } from "@/app/components/projects/phase-plan/milestone-symbol";
import { ARCHIVED_LINK_COLOR } from "@/app/lib/phase-plan/plan-colors";
import {
  formatDayMonth,
  formatRangeLabel,
} from "@/app/lib/phase-plan/plan-dates";
import {
  CARD_HEIGHT,
  POINT_MARKER_SIZE,
} from "@/app/lib/phase-plan/plan-layout";

import type {
  MilestoneStatus,
  PlacedCard,
} from "@/app/lib/phase-plan/plan-types";
import type { Milestone } from "@/definition/Task";

const STATUS_LABEL_KEYS: Readonly<Record<MilestoneStatus, string>> = {
  archived: "projectDetail.planning.phasePlan.statusArchived",
  completed: "projectDetail.planning.phasePlan.statusCompleted",
  open: "projectDetail.planning.phasePlan.statusOpen",
};

function toneOf(card: PlacedCard): string {
  if (card.isArchived) {
    return "opacity-60 saturate-50";
  }

  return card.isPending ? "opacity-70" : "";
}

interface TimelineMilestoneProps {
  readonly card: PlacedCard;
  readonly top: number;
  readonly isSelected: boolean;
  readonly onSelect: (milestone: Milestone) => void;
}

/** Renders one milestone element sized exactly by its time span. */
export function TimelineMilestone({
  card,
  top,
  isSelected,
  onSelect,
}: TimelineMilestoneProps): React.ReactElement {
  const { t } = useTranslation();
  const dateText = card.isRange
    ? formatRangeLabel(card.start, card.end)
    : formatDayMonth(card.end);
  // The chip never exceeds its box, so content can never collide or spill.
  const chip = Math.min(card.chipSize, Math.max(16, card.width - 8));
  // Selected milestones use the same orange tint as active menu entries.
  const selectedTone = isSelected
    ? "border-primary bg-primary-subtle shadow-md ring-2 ring-primary/25"
    : "border-border/60 bg-surface";
  const isMarker = card.density === "marker";
  const isRoomy = card.density === "full" || card.density === "title";

  function handleClick(event: React.MouseEvent<HTMLButtonElement>): void {
    event.stopPropagation();
    onSelect(card.milestone);
  }

  return (
    <button
      type="button"
      disabled={card.isPending}
      className={`absolute z-[6] flex items-center shadow-md outline-none transition-shadow hover:shadow-lg focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-wait border ${selectedTone} ${toneOf(card)} ${
        isMarker
          ? "justify-center rounded-lg"
          : `rounded-xl text-left ${isRoomy ? "justify-start gap-2.5 p-2.5" : "justify-center p-2"}`
      }`}
      style={{
        height: `${CARD_HEIGHT}px`,
        left: `${card.left}px`,
        top: `${top}px`,
        width: `${card.width}px`,
      }}
      title={`${card.milestone.name}\n${dateText}\n${t(STATUS_LABEL_KEYS[card.milestone.status])}`}
      onClick={handleClick}
    >
      <span
        className={`flex shrink-0 items-center justify-center text-white ${isMarker ? "rounded-md" : "rounded-lg"}`}
        style={{
          backgroundColor: card.isArchived ? ARCHIVED_LINK_COLOR : card.hex,
          height: `${chip}px`,
          width: `${chip}px`,
        }}
        aria-hidden="true"
      >
        <MilestoneMarkerIcon
          icon={card.milestone.iconKey ?? null}
          color={card.color}
          className={
            chip >= POINT_MARKER_SIZE ? "size-4 shrink-0" : "size-3 shrink-0"
          }
        />
      </span>
      {isMarker || card.density === "icon" ? null : (
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-semibold text-foreground">
            {card.milestone.name}
          </span>
          {card.density === "full" ? (
            <span className="mt-1 inline-flex items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-[11px] font-medium whitespace-nowrap text-muted-foreground">
              <Calendar className="size-3 shrink-0" aria-hidden="true" />
              {dateText}
            </span>
          ) : null}
        </span>
      )}
    </button>
  );
}
