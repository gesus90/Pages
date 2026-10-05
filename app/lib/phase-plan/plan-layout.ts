import { ARCHIVED_LINK_COLOR } from "@/app/lib/phase-plan/plan-colors";
import { parsePlanDate } from "@/app/lib/phase-plan/plan-dates";
import {
  LANE_ORDER,
  assignGroup,
  getMilestoneColor,
  getMilestoneDisplayColor,
  isArchivedMilestone,
  isPendingMilestoneId,
} from "@/app/lib/phase-plan/plan-milestones";

import type {
  CardDensity,
  DatedMilestone,
  DependencyLink,
  LaneLayout,
  PlacedCard,
} from "@/app/lib/phase-plan/plan-types";
import type { MilestoneDependency } from "@/definition/Task";

/** Height of the sticky timeline header in pixels. */
export const HEADER_HEIGHT = 64;

/** Height of a milestone card in pixels. */
export const CARD_HEIGHT = 68;

/** Vertical distance between the tops of two stacked cards. */
export const CARD_LEVEL_STRIDE = 78;

/** Horizontal gap that keeps two cards on the same level apart. */
const CARD_LEVEL_GAP = 10;

/** Space above the first and below the last card of a lane. */
export const LANE_PADDING = 16;

// Content breakpoints derived from the card typography: a 36px icon chip +
// 10px gap + ~140px date badge + ~20px padding needs roughly 210px for the
// full row; about 40px of readable title fit from roughly 110px; a 32px icon
// chip needs roughly 56px; below roughly 28px only a centered marker stays
// truthful to the underlying time span.
const FULL_ROW_MIN_WIDTH = 210;
const TITLE_ROW_MIN_WIDTH = 110;
const ICON_ROW_MIN_WIDTH = 56;
const MARKER_ROW_MIN_WIDTH = 28;

/** Size of the marker standing for a single day. */
export const POINT_MARKER_SIZE = 32;
const RANGE_MARKER_SIZE = 20;

/**
 * Determines how much content a milestone element can show.
 *
 * @remarks
 * The width always mirrors the exact time span; only the content steps
 * down: date first, then title, then everything but a scaled marker.
 *
 * @param width - Rendered element width in pixels.
 * @returns The matching density level.
 */
export function getCardDensity(width: number): CardDensity {
  if (width >= FULL_ROW_MIN_WIDTH) {
    return "full";
  }

  if (width >= TITLE_ROW_MIN_WIDTH) {
    return "title";
  }

  if (width >= ICON_ROW_MIN_WIDTH) {
    return "icon";
  }

  return "marker";
}

interface CardGeometry {
  readonly density: CardDensity;
  readonly chipSize: number;
  readonly left: number;
  readonly width: number;
}

/** Picks the chip size that fits the width of the milestone's span. */
function getChipSize(spanWidth: number): number {
  if (spanWidth >= TITLE_ROW_MIN_WIDTH) {
    return 36;
  }

  if (spanWidth >= ICON_ROW_MIN_WIDTH) {
    return 32;
  }

  return 24;
}

/**
 * Sizes and places the element of one milestone from its time span.
 *
 * @param start - First instant of the milestone.
 * @param end - Last instant; equal to `start` for a single day.
 * @param timeToX - Maps an instant to its horizontal position.
 */
function measureCard(
  start: number,
  end: number,
  timeToX: (time: number) => number,
): CardGeometry {
  const spanWidth = Math.max(0, timeToX(end) - timeToX(start));

  if (end <= start) {
    const width = POINT_MARKER_SIZE + 8;

    return {
      chipSize: POINT_MARKER_SIZE,
      density: "marker",
      left: timeToX(start) - width / 2,
      width,
    };
  }

  if (spanWidth >= MARKER_ROW_MIN_WIDTH) {
    return {
      chipSize: getChipSize(spanWidth),
      density: getCardDensity(spanWidth),
      left: timeToX(start),
      width: spanWidth,
    };
  }

  const width = RANGE_MARKER_SIZE + 8;

  return {
    chipSize: RANGE_MARKER_SIZE,
    density: "marker",
    left: timeToX(start) + spanWidth / 2 - width / 2,
    width,
  };
}

/** Everything the lane layout needs to know about the visible timeline. */
export interface LaneLayoutInput {
  readonly dated: readonly DatedMilestone[];
  readonly timeToX: (time: number) => number;
  /** How far outside the track cards are still kept, in milliseconds. */
  readonly bufferMs: number;
  readonly pixelsPerDay: number;
  readonly trackWidth: number;
}

/**
 * Sorts the dated milestones into lanes and stacks overlapping ones.
 *
 * @returns The lanes with the cards inside the visible buffer and the total
 * height of all lanes.
 */
export function layoutLanes(input: LaneLayoutInput): {
  readonly lanes: readonly LaneLayout[];
  readonly bodyHeight: number;
} {
  const { dated, timeToX, bufferMs, pixelsPerDay, trackWidth } = input;
  const bufferPx = bufferMs * pixelsPerDay;
  const lanes: LaneLayout[] = [];
  let laneTop = 0;

  for (const key of LANE_ORDER) {
    const items = dated
      .filter((entry) => assignGroup(entry.milestone.name) === key)
      .sort((first, second) => first.time - second.time);

    if (items.length === 0) {
      continue;
    }

    const levelEnds: number[] = [];
    const cards: PlacedCard[] = [];

    for (const item of items) {
      const start = item.time;
      const end = parsePlanDate(item.milestone.dueAt) ?? start;
      const geometry = measureCard(start, end, timeToX);
      let level = levelEnds.findIndex(
        (endX) => endX <= geometry.left - CARD_LEVEL_GAP,
      );

      if (level === -1) {
        level = levelEnds.length;
        levelEnds.push(geometry.left + geometry.width);
      } else {
        levelEnds[level] = geometry.left + geometry.width;
      }

      cards.push({
        ...geometry,
        color: getMilestoneColor(item.milestone),
        end,
        hex: getMilestoneDisplayColor(item.milestone),
        isArchived: isArchivedMilestone(item.milestone),
        isPending: isPendingMilestoneId(item.milestone.id),
        isRange: end > start,
        level,
        milestone: item.milestone,
        start,
      });
    }

    const height =
      LANE_PADDING * 2 +
      levelEnds.length * CARD_HEIGHT +
      Math.max(0, levelEnds.length - 1) * (CARD_LEVEL_STRIDE - CARD_HEIGHT);

    lanes.push({
      cards: cards.filter(
        (card) =>
          card.left + card.width >= -bufferPx &&
          card.left <= trackWidth + bufferPx,
      ),
      height,
      key,
      top: laneTop,
    });
    laneTop += height;
  }

  return { bodyHeight: laneTop, lanes };
}

interface CardAnchor {
  readonly x: number;
  readonly w: number;
  readonly y: number;
  readonly color: string;
  readonly dimmed: boolean;
}

function anchorCards(lanes: readonly LaneLayout[]): Map<string, CardAnchor> {
  const anchors = new Map<string, CardAnchor>();

  for (const lane of lanes) {
    for (const card of lane.cards) {
      anchors.set(card.milestone.id, {
        color: card.isArchived ? ARCHIVED_LINK_COLOR : card.hex,
        dimmed: card.isArchived,
        w: card.width,
        x: card.left,
        y:
          lane.top +
          LANE_PADDING +
          card.level * CARD_LEVEL_STRIDE +
          CARD_HEIGHT / 2,
      });
    }
  }

  return anchors;
}

function linkOpacity(from: CardAnchor, to: CardAnchor): number {
  if (from.dimmed && to.dimmed) {
    return 0.25;
  }

  return from.dimmed || to.dimmed ? 0.45 : 0.9;
}

/**
 * Resolves the dependency lines between the placed cards.
 *
 * @remarks
 * Links render in both directions: the curve starts at the source edge
 * facing the target and ends with an arrow at the target edge. Only truly
 * overlapping cards stay link-free, where the curve would hide behind the
 * cards.
 *
 * @param links - Dependencies between milestones.
 * @param lanes - Lanes with the placed cards.
 */
export function buildDependencyLinks(
  links: readonly MilestoneDependency[],
  lanes: readonly LaneLayout[],
): DependencyLink[] {
  const anchors = anchorCards(lanes);
  const result: DependencyLink[] = [];

  for (const link of links) {
    const from = anchors.get(link.sourceId);
    const to = anchors.get(link.targetId);

    if (!from || !to) {
      continue;
    }

    const rightGap = to.x - (from.x + from.w);
    const leftGap = from.x - (to.x + to.w);

    if (rightGap < 0 && leftGap < 0) {
      continue;
    }

    const isDimmed = from.dimmed || to.dimmed;
    const leftToRight = rightGap >= leftGap;

    result.push({
      fromColor: isDimmed ? ARCHIVED_LINK_COLOR : from.color,
      fromX: leftToRight ? from.x + from.w : from.x,
      fromY: from.y,
      key: link.id,
      leftToRight,
      opacity: linkOpacity(from, to),
      toColor: isDimmed ? ARCHIVED_LINK_COLOR : to.color,
      toX: leftToRight ? to.x : to.x + to.w,
      toY: to.y,
    });
  }

  return result;
}

/**
 * Builds the cubic curve between two milestone edges.
 *
 * @remarks
 * The bend scales with the visible gap so adjacent milestones still get a
 * readable curve instead of no connection at all. Both ends run slightly
 * underneath the connected cards (which render above the lines), so the
 * visible line always touches the card edges regardless of the dash rhythm.
 *
 * @param link - Connection with resolved edge anchors.
 * @returns The SVG path description running into both card edges.
 */
export function dependencyPath(link: DependencyLink): string {
  const gap = Math.abs(link.toX - link.fromX);
  const bend = Math.min(24, Math.max(6, gap / 2));

  if (link.leftToRight) {
    return `M ${link.fromX} ${link.fromY} C ${link.fromX + bend} ${link.fromY}, ${link.toX - bend} ${link.toY}, ${link.toX + 10} ${link.toY}`;
  }

  return `M ${link.fromX} ${link.fromY} C ${link.fromX - bend} ${link.fromY}, ${link.toX + bend} ${link.toY}, ${link.toX - 10} ${link.toY}`;
}
