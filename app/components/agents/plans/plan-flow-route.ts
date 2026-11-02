/** A point of the canvas in flow coordinates. */
interface RoutePoint {
  readonly x: number;
  readonly y: number;
}

/** How far a way back leaves its port sideways before it turns. */
const RETURN_GAP = 36;
/** How far below the lowest of its two cards a way back runs. */
const RETURN_DROP = 40;
/** The radius of the corners of a way back. */
const RETURN_RADIUS = 14;

/** The point at `distance` from `from` towards `to`, never beyond the middle. */
function toward(
  from: RoutePoint,
  to: RoutePoint,
  distance: number,
): RoutePoint {
  const length = Math.hypot(to.x - from.x, to.y - from.y);
  if (length === 0) return from;
  const ratio = Math.min(distance, length / 2) / length;
  return {
    x: from.x + (to.x - from.x) * ratio,
    y: from.y + (to.y - from.y) * ratio,
  };
}

/**
 * An SVG path through the points with rounded corners.
 *
 * @param points - The corners of the line, the two ends included.
 * @param radius - The largest radius of a corner; short segments round less.
 */
export function planRoundedPath(
  points: readonly RoutePoint[],
  radius: number,
): string {
  const [first, ...rest] = points;
  if (!first) return "";
  const commands = [`M${first.x},${first.y}`];
  rest.forEach((point, index) => {
    const next = rest[index + 1];
    if (!next) {
      commands.push(`L${point.x},${point.y}`);
      return;
    }
    const before = toward(point, points[index] ?? first, radius);
    const after = toward(point, next, radius);
    commands.push(
      `L${before.x},${before.y}`,
      `Q${point.x},${point.y} ${after.x},${after.y}`,
    );
  });
  return commands.join(" ");
}

/** The ends of a way back and the lowest edge of the two cards it joins. */
interface PlanReturnRoute {
  readonly sourceX: number;
  readonly sourceY: number;
  readonly targetX: number;
  readonly targetY: number;
  /** The lowest edge of the two cards; the line runs below it. */
  readonly bottom: number;
}

/**
 * Whether a connection runs against the direction of the flow: its target lies
 * left of its source, so the plain curve would cut through both cards.
 */
export function isPlanReturn(route: PlanReturnRoute): boolean {
  return route.targetX < route.sourceX + 2 * RETURN_GAP;
}

/**
 * The path of a connection that returns to an earlier card: out of the source
 * to the right, below both cards, and into the target from the left.
 *
 * @returns The path, and the middle of its lowest run, where the label sits.
 *
 * @remarks
 * Both ends are exactly the handle centres React Flow measured, so the line
 * and its arrow end at the port after zooming, resizing or a card growing.
 */
export function planReturnPath(
  route: PlanReturnRoute,
): readonly [path: string, labelX: number, labelY: number] {
  const lowest = Math.max(route.bottom, route.sourceY, route.targetY);
  const runY = lowest + RETURN_DROP;
  const outX = route.sourceX + RETURN_GAP;
  const inX = route.targetX - RETURN_GAP;
  const path = planRoundedPath(
    [
      { x: route.sourceX, y: route.sourceY },
      { x: outX, y: route.sourceY },
      { x: outX, y: runY },
      { x: inX, y: runY },
      { x: inX, y: route.targetY },
      { x: route.targetX, y: route.targetY },
    ],
    RETURN_RADIUS,
  );
  return [path, (outX + inX) / 2, runY];
}

/** A port as React Flow measured it, relative to its card. */
interface PortBounds {
  readonly id?: string | null;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** What of a measured card a line needs to find a port; React Flow's internal node has it. */
interface PortCard {
  readonly internals: {
    readonly positionAbsolute: RoutePoint;
    readonly handleBounds?: {
      readonly source?: readonly PortBounds[] | null;
      readonly target?: readonly PortBounds[] | null;
    };
  };
}

/**
 * The centre of the port a connection joins, from the size React Flow measured.
 *
 * @param node - The card that holds the port.
 * @param type - Whether the connection leaves (`source`) or enters (`target`) it.
 * @param handleId - The port, as the edge names it.
 * @returns The centre in flow coordinates, or `null` while the card or its port is not measured yet.
 *
 * @remarks
 * React Flow ends a line on the rim of a port. The connection ends on the
 * centre instead, which stays right after zooming, resizing or a card growing.
 */
export function planPortCentre(
  node: PortCard | undefined,
  type: "source" | "target",
  handleId: string | null | undefined,
): RoutePoint | null {
  const port = node?.internals.handleBounds?.[type]?.find(
    (entry) => entry.id === (handleId ?? null),
  );
  if (!node || !port) return null;
  const origin = node.internals.positionAbsolute;
  return {
    x: origin.x + port.x + port.width / 2,
    y: origin.y + port.y + port.height / 2,
  };
}
