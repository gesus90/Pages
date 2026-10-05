import { isWorkItemLinkType, WORK_ITEM_LINK_TYPE } from "@/definition/Task";

import type { WorkItemLink, WorkItemLinkType } from "@/definition/Task";

/** Translation keys naming a link from the point of view of one ticket. */
type LinkTypeLabelKey =
  | "tasks.links.type.blockedBy"
  | "tasks.links.type.blocks"
  | "tasks.links.type.duplicatedBy"
  | "tasks.links.type.duplicates"
  | "tasks.links.type.relatesTo";

/**
 * Picks the translation key that names a link for the ticket showing it.
 *
 * @remarks
 * A link is stored once, so the opposite ticket sees the mirrored name:
 * "blocks" becomes "blocked by" and "duplicates" becomes "duplicated by".
 */
export function getLinkTypeLabelKey(link: WorkItemLink): LinkTypeLabelKey {
  if (link.linkType === WORK_ITEM_LINK_TYPE.RELATES_TO) {
    return "tasks.links.type.relatesTo";
  }

  const isOutgoing = link.direction === "outgoing";

  if (link.linkType === WORK_ITEM_LINK_TYPE.BLOCKS) {
    return isOutgoing
      ? "tasks.links.type.blocks"
      : "tasks.links.type.blockedBy";
  }

  return isOutgoing
    ? "tasks.links.type.duplicates"
    : "tasks.links.type.duplicatedBy";
}

/**
 * Turns the value of the link type select into a link type.
 *
 * @param value - Value reported by the select.
 * @returns The link type, or "relates to" for a value that names none.
 */
export function parseLinkType(value: string): WorkItemLinkType {
  return isWorkItemLinkType(value) ? value : WORK_ITEM_LINK_TYPE.RELATES_TO;
}
