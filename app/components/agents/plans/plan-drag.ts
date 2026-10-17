/** Marks a drag that carries an agent, which the grid can tell during the drag already. */
export const PLAN_AGENT_DRAG = "application/x-pages-plan-agent";

/** The drag format of sources that the side panel offers for the grid. */
export const PLAN_SOURCE_DRAG = "application/x-pages-plan";

/** A source the grid receives, as the drag from the side panel carried it. */
export interface PlanDragData {
  readonly kind: string;
  readonly reference: string;
}

/** Reads the drag data of the plan grid; `null` for a drag from elsewhere. */
export function readPlanDrag(transfer: DataTransfer): PlanDragData | null {
  const [kind, reference] = transfer.getData(PLAN_SOURCE_DRAG).split(":");
  if (!kind || !reference) return null;
  return { kind, reference };
}
