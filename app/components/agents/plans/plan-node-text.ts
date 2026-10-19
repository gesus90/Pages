/**
 * The shared type roles of every plan node family.
 *
 * @remarks
 * Start, end, agent, parameter, ticket and group cards differ in size and
 * color, never in these roles: a title is 14 px on 20 px in semibold, a
 * field or value 12 px on 18 px, a type line or extra information 11 px on
 * 16 px. Larger cards get no larger titles; the canvas zoom scales all roles
 * together.
 */
export const PLAN_NODE_TEXT = {
  title: "text-sm leading-5 font-semibold",
  field: "text-xs leading-4.5",
  meta: "text-[11px] leading-4",
} as const;

/** The type icon beside a node title, the same on every card. */
export const PLAN_NODE_ICON = "size-4.5";
