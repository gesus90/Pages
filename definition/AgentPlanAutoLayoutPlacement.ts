import type { AgentPlanPosition } from "./AgentPlan";

/** The gap between two ranks, in grid pixels. */
export const PLAN_LAYOUT_RANK_GAP = 80;
/** The gap between two nodes of one rank, in grid pixels. */
export const PLAN_LAYOUT_NODE_GAP = 40;
/** The largest coordinate a stored plan accepts, as `readPlanInput` checks it. */
export const PLAN_LAYOUT_COORDINATE_LIMIT = 6000;
/**
 * How many narrower line widths a level tries before it gives up.
 *
 * @remarks
 * A rank wider than the grid wraps into lines; when the folded bands of
 * such lines do not fit side by side, narrower lines leave room for more
 * bands.
 */
const LINE_SPLITS = 8;

/** Ranks run from top to bottom (`TB`) or from left to right (`LR`), as in Graphviz. */
export type PlanRankDirection = "TB" | "LR";

/** A node of one level as the layout sees it: an identifier and a size. */
export interface LayoutBox {
  readonly id: string;
  readonly width: number;
  readonly height: number;
}

/** How far the top left corner of a box may lie from where a block starts. */
export interface LayoutBudget {
  readonly x: number;
  readonly y: number;
}

/** An offset along the line and one in the direction the ranks advance. */
interface LayoutOffsets {
  readonly line: number;
  readonly rank: number;
}

/** Boxes of one rank that share one line; a wide rank wraps into several. */
interface LayoutLine {
  readonly boxes: readonly LayoutBox[];
  /** The extent along the line, the gaps included. */
  readonly length: number;
  /** The extent across the line: its deepest box. */
  readonly depth: number;
}

/** Lines that stand one after another; a full band continues in the next one beside it. */
type LayoutBand = readonly LayoutLine[];

/** Reads the sizes of a box along and across the ranks for one direction. */
class LayoutAxes {
  private readonly isVertical: boolean;

  /**
   * Creates the axes.
   *
   * @param rankdir - `TB` lays ranks out downwards, `LR` to the right.
   */
  public constructor(rankdir: PlanRankDirection) {
    this.isVertical = rankdir === "TB";
  }

  /**
   * The size of a box along its line: its width for `TB`, its height for `LR`.
   *
   * @param box - The box.
   */
  public along(box: LayoutBox): number {
    return this.isVertical ? box.width : box.height;
  }

  /**
   * The size of a box across its line, in the direction the ranks advance.
   *
   * @param box - The box.
   */
  public across(box: LayoutBox): number {
    return this.isVertical ? box.height : box.width;
  }

  /**
   * The budget along the lines and in the direction the ranks advance.
   *
   * @param budget - The budget in grid coordinates.
   */
  public split(budget: LayoutBudget): LayoutOffsets {
    return this.isVertical
      ? { line: budget.x, rank: budget.y }
      : { line: budget.y, rank: budget.x };
  }

  /**
   * A grid position from an offset along the line and one in the rank direction.
   *
   * @param line - The offset along the line.
   * @param rank - The offset in the direction the ranks advance.
   */
  public position(line: number, rank: number): AgentPlanPosition {
    return this.isVertical ? { x: line, y: rank } : { x: rank, y: line };
  }
}

/** Wraps a rank into lines no longer than the limit; a single box always gets a line. */
function wrapRank(
  row: readonly LayoutBox[],
  axes: LayoutAxes,
  limit: number,
): readonly LayoutLine[] {
  const lines: LayoutLine[] = [];
  let boxes: LayoutBox[] = [];
  let length = 0;
  const close = (): void => {
    if (boxes.length === 0) return;
    lines.push({
      boxes,
      length,
      depth: Math.max(...boxes.map((box) => axes.across(box))),
    });
    boxes = [];
    length = 0;
  };
  for (const box of row) {
    if (
      boxes.length > 0 &&
      length + PLAN_LAYOUT_NODE_GAP + axes.along(box) > limit
    )
      close();
    length += (boxes.length > 0 ? PLAN_LAYOUT_NODE_GAP : 0) + axes.along(box);
    boxes.push(box);
  }
  close();
  return lines;
}

/** Folds lines into bands, so no band reaches beyond the budget in the rank direction. */
function foldLines(
  lines: readonly LayoutLine[],
  rankBudget: number,
): readonly LayoutBand[] {
  const bands: LayoutLine[][] = [];
  let band: LayoutLine[] = [];
  let reach = 0;
  for (const line of lines) {
    if (band.length > 0 && reach + line.depth > rankBudget) {
      bands.push(band);
      band = [];
      reach = 0;
    }
    band.push(line);
    reach += line.depth + PLAN_LAYOUT_RANK_GAP;
  }
  if (band.length > 0) bands.push(band);
  return bands;
}

/**
 * Places the boxes of one line one after another, 40 px apart.
 *
 * @returns `false` when a top left corner passes the budget.
 */
function placeLine(
  line: LayoutLine,
  start: LayoutOffsets,
  layout: {
    readonly axes: LayoutAxes;
    readonly budget: LayoutOffsets;
    readonly positions: Map<string, AgentPlanPosition>;
  },
): boolean {
  const { axes, budget, positions } = layout;
  if (start.rank > budget.rank) return false;
  let offset = start.line;
  for (const box of line.boxes) {
    if (offset > budget.line) return false;
    positions.set(box.id, axes.position(offset, start.rank));
    offset += axes.along(box) + PLAN_LAYOUT_NODE_GAP;
  }
  return true;
}

/**
 * Places folded bands: lines centred in their band, bands 80 px apart.
 *
 * @returns The positions, or `null` when a top left corner passes the budget.
 */
function placeBands(
  bands: readonly LayoutBand[],
  axes: LayoutAxes,
  budget: LayoutOffsets,
): Map<string, AgentPlanPosition> | null {
  const positions = new Map<string, AgentPlanPosition>();
  let bandStart = 0;
  for (const band of bands) {
    const width = Math.max(...band.map((line) => line.length));
    let rank = 0;
    for (const line of band) {
      const start = {
        line: bandStart + Math.floor((width - line.length) / 2),
        rank,
      };
      if (!placeLine(line, start, { axes, budget, positions })) return null;
      rank += line.depth + PLAN_LAYOUT_RANK_GAP;
    }
    bandStart += width + PLAN_LAYOUT_RANK_GAP;
  }
  return positions;
}

/**
 * Places ordered ranks inside a budget: 80 px between ranks, 40 px between the boxes of a rank.
 *
 * @param rows - The ranks, each in its order; empty ranks are skipped.
 * @param rankdir - The direction the ranks advance.
 * @param budget - How far a top left corner may lie from the start of the block.
 * @returns Positions relative to the start of the block, or `null` when the
 * boxes cannot be placed inside the budget without covering each other.
 *
 * @remarks
 * A plan that fits keeps the plain layered layout: each rank one centred
 * line. A rank longer than the budget wraps into lines, and lines that would
 * pass the budget in the rank direction fold into a new band beside the
 * first, as wide as its widest line. Nothing is clamped: every box keeps its
 * own place, so no two cards cover each other. When even the narrowest of
 * the tried line widths does not fit, the answer is `null`.
 */
export function placePlanRows(
  rows: readonly (readonly LayoutBox[])[],
  rankdir: PlanRankDirection,
  budget: LayoutBudget,
): Map<string, AgentPlanPosition> | null {
  const axes = new LayoutAxes(rankdir);
  const limits = axes.split(budget);
  if (limits.line < 0 || limits.rank < 0) return null;
  const filled = rows.filter((row) => row.length > 0);
  for (let split = 1; split <= LINE_SPLITS; split += 1) {
    const lineLimit = Math.floor(limits.line / split);
    const lines = filled.flatMap((row) => wrapRank(row, axes, lineLimit));
    const placed = placeBands(foldLines(lines, limits.rank), axes, limits);
    if (placed) return placed;
  }
  return null;
}
