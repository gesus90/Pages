import { planOrderEdges } from "./AgentPlanBranching";
import { planGroupEdges } from "./AgentPlanGroup";
import {
  PLAN_LAYOUT_COORDINATE_LIMIT,
  PLAN_LAYOUT_RANK_GAP,
  placePlanRows,
} from "./AgentPlanAutoLayoutPlacement";
import { planNodeHeight, planNodeWidth } from "./AgentPlanNodeSize";

import type {
  AgentPlanBinding,
  AgentPlanEdge,
  AgentPlanInput,
  AgentPlanNode,
  AgentPlanPosition,
  AgentPlanSources,
} from "./AgentPlan";
import type {
  LayoutBox,
  PlanRankDirection,
} from "./AgentPlanAutoLayoutPlacement";
import type { AgentPlanGroup } from "./AgentPlanGroup";
import type { AgentPlanLoopContent } from "./AgentPlanLoop";

/** Where the outer graph starts, as the editor places its first node. */
const OUTER_ORIGIN = 40;

export type { PlanRankDirection } from "./AgentPlanAutoLayoutPlacement";

/**
 * A plan whose layout does not fit the coordinates a stored plan accepts.
 *
 * @remarks
 * Every node keeps its own place, nothing is clamped onto another; when the
 * grid is too small for that, the layout refuses instead of letting cards
 * cover each other.
 */
export class PlanLayoutOverflowError extends Error {
  /** The group or loop whose members do not fit, or `null` for the outer graph. */
  public readonly containerId: string | null;

  /**
   * Creates the error.
   *
   * @param containerId - The frame whose members do not fit, or `null` for the outer graph.
   */
  public constructor(containerId: string | null) {
    super("The plan layout does not fit the coordinate limit.");
    this.name = "PlanLayoutOverflowError";
    this.containerId = containerId;
  }
}

/** How a plan is laid out. */
export interface PlanAutoLayoutOptions {
  readonly rankdir: PlanRankDirection;
  /**
   * The stored plan when a plan is replaced.
   *
   * @remarks
   * A node that keeps its identifier and its container keeps its stored
   * position; only the others are laid out, beside the existing graph.
   * Absent, every node is laid out anew.
   */
  readonly previous?: AgentPlanInput | null;
}

/** A link between two boxes of one level; data links only place value sources. */
interface LayoutLink {
  readonly from: string;
  readonly to: string;
  readonly isFlow: boolean;
}

/** Everything one level of the plan, the outer graph or a frame, is laid out from. */
interface LayoutLevel {
  readonly boxes: readonly LayoutBox[];
  readonly links: readonly LayoutLink[];
  readonly origin: number;
  /** Stored positions of the boxes that keep theirs. */
  readonly kept: ReadonlyMap<string, AgentPlanPosition>;
}

/** Anything that holds bindings and may therefore read another node. */
type BindingHolder = Extract<
  AgentPlanNode,
  { readonly bindings: Readonly<Record<string, AgentPlanBinding>> }
>;

function hasBindings(node: AgentPlanNode): node is BindingHolder {
  return "bindings" in node;
}

/** The node a binding reads; a previous iteration orders nothing. */
function boundSource(binding: AgentPlanBinding): string | null {
  if (binding.kind === "source") return binding.nodeId;
  if (binding.kind === "result") return binding.stepId;
  return binding.kind === "stack" ? binding.stackId : null;
}

/** The members of a frame, and those of the groups of a loop, by the member they belong to. */
function memberOwners(
  members: readonly (AgentPlanNode | AgentPlanLoopContent)[],
): Map<string, string> {
  const owners = new Map<string, string>();
  for (const member of members) {
    owners.set(member.id, member.id);
    if (member.type === "group" || member.type === "loop")
      for (const nested of memberOwners(member.steps).keys())
        owners.set(nested, member.id);
  }
  return owners;
}

/** Every node of a level with the nodes inside it. */
function levelNodes(
  members: readonly (AgentPlanNode | AgentPlanLoopContent)[],
): readonly AgentPlanNode[] {
  return members.flatMap((member): readonly AgentPlanNode[] =>
    member.type === "group" || member.type === "loop"
      ? [member, ...levelNodes(member.steps)]
      : [member],
  );
}

/** Flow and data links between the boxes of a level, each pair once. */
function levelLinks(
  members: readonly (AgentPlanNode | AgentPlanLoopContent)[],
  edges: readonly AgentPlanEdge[],
): readonly LayoutLink[] {
  const owners = memberOwners(members);
  const links = new Map<string, LayoutLink>();
  function add(from: string, to: string, isFlow: boolean): void {
    const source = owners.get(from);
    const target = owners.get(to);
    if (source === undefined || target === undefined || source === target)
      return;
    const key = `${source}\n${target}`;
    if (!links.get(key)?.isFlow)
      links.set(key, { from: source, to: target, isFlow });
  }
  for (const edge of planOrderEdges(edges)) add(edge.from, edge.to, true);
  for (const node of levelNodes(members)) {
    if (!hasBindings(node)) continue;
    for (const binding of Object.values(node.bindings)) {
      const source = boundSource(binding);
      if (source !== null) add(source, node.id, false);
    }
  }
  return [...links.values()];
}

/** Flow links that close a cycle, found depth first in the order of the boxes. */
function backLinks(
  boxes: readonly LayoutBox[],
  flow: readonly LayoutLink[],
): ReadonlySet<LayoutLink> {
  const back = new Set<LayoutLink>();
  const state = new Map<string, "open" | "done">();
  function visit(id: string): void {
    state.set(id, "open");
    for (const link of flow) {
      if (link.from !== id) continue;
      const next = state.get(link.to);
      if (next === "open") back.add(link);
      else if (next === undefined) visit(link.to);
    }
    state.set(id, "done");
  }
  // Nodes without incoming flow, the start above all, open the search, so a
  // cycle is broken at the edge that leads back, not at the way in.
  const roots = boxes.filter((box) => !flow.some((link) => link.to === box.id));
  for (const box of [...roots, ...boxes]) if (!state.has(box.id)) visit(box.id);
  return back;
}

/** The longest path over the flow links to every box, in a graph without cycles. */
function flowRanks(
  boxes: readonly LayoutBox[],
  flow: readonly LayoutLink[],
): Map<string, number> {
  const ranks = new Map(boxes.map((box) => [box.id, 0]));
  const incoming = new Map(boxes.map((box) => [box.id, 0]));
  for (const link of flow)
    incoming.set(link.to, (incoming.get(link.to) ?? 0) + 1);
  const ready = boxes.filter((box) => incoming.get(box.id) === 0);
  for (let current = ready.shift(); current; current = ready.shift()) {
    const rank = ranks.get(current.id) ?? 0;
    for (const link of flow) {
      if (link.from !== current.id) continue;
      ranks.set(link.to, Math.max(ranks.get(link.to) ?? 0, rank + 1));
      const left = (incoming.get(link.to) ?? 1) - 1;
      incoming.set(link.to, left);
      const next = boxes.find((box) => box.id === link.to);
      if (left === 0 && next) ready.push(next);
    }
  }
  return ranks;
}

/**
 * The rank of every box: the longest flow path, a value source one rank before its first target.
 *
 * @remarks
 * A source moved before rank 0 shifts every rank by one, so ranks start at 0.
 */
function levelRanks(
  boxes: readonly LayoutBox[],
  links: readonly LayoutLink[],
): Map<string, number> {
  const allFlow = links.filter((link) => link.isFlow);
  const back = backLinks(boxes, allFlow);
  const ranks = flowRanks(
    boxes,
    allFlow.filter((link) => !back.has(link)),
  );
  const flowing = new Set(allFlow.flatMap((link) => [link.from, link.to]));
  for (const box of boxes) {
    if (flowing.has(box.id)) continue;
    const targets = links
      .filter((link) => !link.isFlow && link.from === box.id)
      .map((link) => ranks.get(link.to) ?? 0);
    if (targets.length > 0) ranks.set(box.id, Math.min(...targets) - 1);
  }
  const lowest = Math.min(0, ...ranks.values());
  return new Map([...ranks].map(([id, rank]) => [id, rank - lowest]));
}

/** The mean position of the neighbours in their rank, or `null` without any. */
function barycenter(
  neighbours: readonly string[],
  position: ReadonlyMap<string, number>,
): number | null {
  const places = neighbours.flatMap((id) => {
    const place = position.get(id);
    return place === undefined ? [] : [place];
  });
  if (places.length === 0) return null;
  return places.reduce((sum, place) => sum + place, 0) / places.length;
}

/** The neighbours of a box in lower (`before`) or higher (`after`) ranks. */
function rankNeighbours(
  box: LayoutBox,
  links: readonly LayoutLink[],
  input: {
    readonly ranks: ReadonlyMap<string, number>;
    readonly side: "before" | "after";
  },
): readonly string[] {
  const { ranks, side } = input;
  const rank = ranks.get(box.id) ?? 0;
  return side === "before"
    ? links
        .filter(
          (link) => link.to === box.id && (ranks.get(link.from) ?? 0) < rank,
        )
        .map((link) => link.from)
    : links
        .filter(
          (link) => link.from === box.id && (ranks.get(link.to) ?? 0) > rank,
        )
        .map((link) => link.to);
}

/**
 * Orders the boxes of every rank by the barycenter of their predecessors, in two passes.
 *
 * @remarks
 * Each pass runs from the first rank to the last, so a rank is ordered by
 * the rank before it as just ordered. A box without predecessors keeps its
 * place in the stored order in the first pass; the second pass places it by
 * its successors as the first pass ordered them, so a value source moves
 * next to the node it feeds.
 */
function orderRanks(
  boxes: readonly LayoutBox[],
  links: readonly LayoutLink[],
  ranks: ReadonlyMap<string, number>,
): readonly (readonly LayoutBox[])[] {
  const depth = Math.max(0, ...ranks.values());
  let rows = Array.from({ length: depth + 1 }, (_, rank) =>
    boxes.filter((box) => ranks.get(box.id) === rank),
  );
  let earlier: ReadonlyMap<string, number> = new Map();
  for (const pass of [1, 2]) {
    const position = new Map<string, number>();
    rows = rows.map((row) => {
      const keyed = row.map((box, index) => {
        const before = rankNeighbours(box, links, { ranks, side: "before" });
        const after = rankNeighbours(box, links, { ranks, side: "after" });
        const key =
          barycenter(before, position) ??
          (pass === 2 ? barycenter(after, earlier) : null) ??
          index;
        return { box, key };
      });
      const sorted = [...keyed].sort((first, second) => first.key - second.key);
      sorted.forEach((entry, index) => position.set(entry.box.id, index));
      return sorted.map((entry) => entry.box);
    });
    earlier = position;
  }
  return rows;
}

/** The smallest rectangle around boxes at their positions. */
function extent(
  boxes: readonly LayoutBox[],
  positions: ReadonlyMap<string, AgentPlanPosition>,
): LayoutArea {
  const placed = boxes.flatMap((box) => {
    const position = positions.get(box.id);
    return position ? [{ box, position }] : [];
  });
  return {
    left: Math.min(...placed.map((entry) => entry.position.x)),
    top: Math.min(...placed.map((entry) => entry.position.y)),
    right: Math.max(
      ...placed.map((entry) => entry.position.x + entry.box.width),
    ),
    bottom: Math.max(
      ...placed.map((entry) => entry.position.y + entry.box.height),
    ),
  };
}

/** A rectangle by its four sides. */
interface LayoutArea {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

/**
 * Where new boxes may start beside what stays, the preferred side first.
 *
 * @remarks
 * Below what stays from its left edge (`TB`) or right of it from its top
 * edge (`LR`); the other side follows when the first is too small. Both
 * areas lie wholly beyond every box that stays, so nothing placed there
 * covers it.
 */
function besideKept(
  area: LayoutArea,
  rankdir: PlanRankDirection,
): readonly AgentPlanPosition[] {
  const below = { x: area.left, y: area.bottom + PLAN_LAYOUT_RANK_GAP };
  const beside = { x: area.right + PLAN_LAYOUT_RANK_GAP, y: area.top };
  return rankdir === "TB" ? [below, beside] : [beside, below];
}

/**
 * Lays out one level and fits its new boxes beside the boxes that keep their place.
 *
 * @returns The positions, or `null` when the new boxes fit nowhere inside the coordinate limit.
 *
 * @remarks
 * Ranks and order come from every box of the level, so new boxes keep
 * their relation to the old ones; only the new boxes are placed, as one
 * block below (`TB`) or to the right of (`LR`) everything that stays. Boxes
 * that stay keep their stored position exactly.
 */
function layoutLevel(
  level: LayoutLevel,
  rankdir: PlanRankDirection,
): Map<string, AgentPlanPosition> | null {
  const { boxes, links, kept, origin } = level;
  const positions = new Map<string, AgentPlanPosition>(kept);
  if (boxes.every((box) => kept.has(box.id))) return positions;
  const rows = orderRanks(boxes, links, levelRanks(boxes, links)).map((row) =>
    row.filter((box) => !kept.has(box.id)),
  );
  const stays = boxes.filter((box) => kept.has(box.id));
  const anchors =
    stays.length === 0
      ? [{ x: origin, y: origin }]
      : besideKept(extent(stays, kept), rankdir);
  for (const anchor of anchors) {
    const placed = placePlanRows(rows, rankdir, {
      x: PLAN_LAYOUT_COORDINATE_LIMIT - anchor.x,
      y: PLAN_LAYOUT_COORDINATE_LIMIT - anchor.y,
    });
    if (!placed) continue;
    for (const [id, position] of placed)
      positions.set(id, { x: anchor.x + position.x, y: anchor.y + position.y });
    return positions;
  }
  return null;
}

/** A box as the stored plan had it: its place and its size. */
interface StoredBox extends AgentPlanPosition {
  readonly width: number;
  readonly height: number;
}

/** Stored boxes by container (empty for the outer graph) and node identifier. */
function storedBoxes(
  previous: AgentPlanInput | null | undefined,
  sources: AgentPlanSources,
): Map<string, StoredBox> {
  const boxes = new Map<string, StoredBox>();
  function collect(
    container: string,
    members: readonly (AgentPlanNode | AgentPlanLoopContent)[],
  ): void {
    for (const member of members) {
      boxes.set(`${container}\n${member.id}`, {
        x: member.x,
        y: member.y,
        width: planNodeWidth(member),
        height: planNodeHeight(member, sources),
      });
      if (member.type === "group" || member.type === "loop")
        collect(member.id, member.steps);
    }
  }
  if (previous) collect("", previous.nodes);
  return boxes;
}

function isOverlapping(
  first: AgentPlanPosition & Pick<LayoutBox, "width" | "height">,
  second: AgentPlanPosition & Pick<LayoutBox, "width" | "height">,
): boolean {
  return (
    first.x < second.x + second.width &&
    second.x < first.x + first.width &&
    first.y < second.y + second.height &&
    second.y < first.y + first.height
  );
}

/**
 * The boxes that keep their stored place.
 *
 * @remarks
 * A frame that grew with new members would cover what stands next to it;
 * it changed, so it moves with the new boxes instead of covering anything.
 */
function keptPlaces(
  boxes: readonly LayoutBox[],
  stored: (id: string) => StoredBox | undefined,
): Map<string, AgentPlanPosition> {
  const kept = boxes.flatMap((box) => {
    const previous = stored(box.id);
    return previous ? [{ box, previous }] : [];
  });
  const places = new Map<string, AgentPlanPosition>();
  for (const { box, previous } of kept) {
    const isGrown = box.width > previous.width || box.height > previous.height;
    const current = { ...box, x: previous.x, y: previous.y };
    const isCovering =
      isGrown &&
      kept.some(
        (other) =>
          other.box.id !== box.id &&
          isOverlapping(current, {
            ...other.box,
            x: other.previous.x,
            y: other.previous.y,
          }),
      );
    if (!isCovering) places.set(box.id, { x: previous.x, y: previous.y });
  }
  return places;
}

/** Lays out the members of every frame first, since a frame grows with them. */
class PlanLevelLayout {
  private readonly sources: AgentPlanSources;
  private readonly rankdir: PlanRankDirection;
  private readonly stored: ReadonlyMap<string, StoredBox>;

  public constructor(
    sources: AgentPlanSources,
    options: PlanAutoLayoutOptions,
  ) {
    this.sources = sources;
    this.rankdir = options.rankdir;
    this.stored = storedBoxes(options.previous, sources);
  }

  /** Positions the outer nodes, each frame with its members. */
  public arrangeNodes(
    nodes: readonly AgentPlanNode[],
    edges: readonly AgentPlanEdge[],
  ): AgentPlanNode[] {
    const sized = nodes.map((node): AgentPlanNode => {
      if (node.type === "group") return this.withSteps(node);
      if (node.type !== "loop") return node;
      return {
        ...node,
        steps: this.arrangeContent(node.id, node.steps, node.edges),
      };
    });
    const positions = this.place("", sized, edges);
    return sized.map((node) => ({ ...node, ...positions(node.id) }));
  }

  private withSteps(group: AgentPlanGroup): AgentPlanGroup {
    const positions = this.place(group.id, group.steps, planGroupEdges(group));
    return {
      ...group,
      steps: group.steps.map((step) => ({ ...step, ...positions(step.id) })),
    };
  }

  private arrangeContent(
    container: string,
    members: readonly AgentPlanLoopContent[],
    edges: readonly AgentPlanEdge[],
  ): AgentPlanLoopContent[] {
    const sized = members.map((member) =>
      member.type === "group" ? this.withSteps(member) : member,
    );
    const positions = this.place(container, sized, edges);
    return sized.map((member) => ({ ...member, ...positions(member.id) }));
  }

  /** Lays out the members of one container, whose own members are already in place. */
  private place(
    container: string,
    members: readonly (AgentPlanNode | AgentPlanLoopContent)[],
    edges: readonly AgentPlanEdge[],
  ): (id: string) => AgentPlanPosition {
    const boxes = members.map((member) => ({
      id: member.id,
      width: planNodeWidth(member),
      height: planNodeHeight(member, this.sources),
    }));
    const kept = keptPlaces(boxes, (id) =>
      this.stored.get(`${container}\n${id}`),
    );
    const positions = layoutLevel(
      {
        boxes,
        links: levelLinks(members, edges),
        kept,
        origin: container === "" ? OUTER_ORIGIN : 0,
      },
      this.rankdir,
    );
    if (!positions) throw new PlanLayoutOverflowError(container || null);
    return (id) => positions.get(id) ?? { x: 0, y: 0 };
  }
}

/**
 * Computes the positions of every node of a plan with a layered layout (PAGE-250).
 *
 * @param plan - The plan; its stored positions are ignored unless kept.
 * @param sources - What sizes the cards: the agents, whose inputs make a card taller.
 * @param options - The direction of the ranks and, when replacing, the stored plan.
 * @returns The plan with new positions; nothing else changes.
 *
 * @remarks
 * The rank of a node is the longest path over the flow edges from the
 * start; flow edges that close a cycle do not count. A value source without
 * flow edges stands one rank before its first target. Within a rank the
 * nodes follow the barycenter of their predecessors, in two passes. The
 * members of a group or loop are laid out the same way inside their frame,
 * relative to its member origin, and the frame counts as one node of its
 * size outside. Sizes are those of the editor's cards. A level too large
 * for one band folds into bands beside each other, and a rank too wide
 * wraps into lines; no coordinate passes 6000 and no two cards cover each
 * other.
 * @throws PlanLayoutOverflowError When a level does not fit the coordinate
 * limit even folded; boxes that keep their place are never moved for it.
 */
export function layoutPlan<Plan extends AgentPlanInput>(
  plan: Plan,
  sources: AgentPlanSources,
  options: PlanAutoLayoutOptions,
): Plan {
  const layout = new PlanLevelLayout(sources, options);
  return { ...plan, nodes: layout.arrangeNodes(plan.nodes, plan.edges) };
}
