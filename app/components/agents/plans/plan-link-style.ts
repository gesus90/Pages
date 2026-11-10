import { planBranchChannel } from "./plan-links";

import type { PlanLinkChannel } from "./plan-links";
import type { PlanConnection } from "./use-plan-connections";

/**
 * The line colour of every kind of connection, as theme tokens.
 *
 * @remarks
 * Flow and data stay neutral as before; the boolean wire is violet like the
 * decision it enters, the two branches are green and amber, and the wire that
 * carries a new prompt back to an agent is blue. Colour is never the only
 * difference: the dash and the label of the line name the kind as well.
 */
export const PLAN_LINK_STROKE: Readonly<Record<PlanLinkChannel, string>> = {
  flow: "var(--color-muted-foreground)",
  data: "var(--color-muted-foreground)",
  condition: "var(--color-plan-logic-edge)",
  true: "var(--color-success)",
  false: "var(--color-warning)",
  case: "var(--color-plan-logic-edge)",
  event: "var(--color-info)",
};

/** The dash of a line: solid for the ordering connections, dashed for what only carries a value. */
export const PLAN_LINK_DASH: Readonly<
  Record<PlanLinkChannel, string | undefined>
> = {
  flow: undefined,
  data: "6 5",
  condition: "5 4",
  true: undefined,
  false: undefined,
  case: undefined,
  event: "9 5",
};

/** The classes of the label that names a connection, by kind. */
export const PLAN_LINK_LABEL_TONE: Readonly<Record<PlanLinkChannel, string>> = {
  flow: "border-border text-muted-foreground",
  data: "border-border border-dashed text-muted-foreground",
  condition: "border-plan-logic-edge/60 border-dashed text-plan-logic",
  true: "border-success/50 font-semibold text-success",
  false: "border-warning/50 font-semibold text-warning",
  case: "border-plan-logic-edge/60 font-semibold text-plan-logic",
  event: "border-info/50 border-dashed text-info",
};

/** The kind of line a connection that is still being made will become. */
export function planConnectionChannel(
  connection: PlanConnection,
): PlanLinkChannel {
  if (connection.kind === "branch") return planBranchChannel(connection.branch);
  if (connection.kind === "passed") return "condition";
  return connection.kind === "flow" ? "flow" : "data";
}
