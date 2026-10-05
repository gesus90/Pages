import { useState } from "react";

import { MILESTONE_LINK_TYPE } from "@/definition/Task";

import type {
  LinkCandidate,
  LinkOperations,
  RevertToken,
  WorkingLink,
} from "@/app/lib/phase-plan/plan-types";

const PENDING_LINK_PREFIX = "pending-link-";

/** The dependencies the panel edits and what they changed from. */
export interface PanelLinksState {
  readonly workingLinks: readonly WorkingLink[];
  readonly removedLinkIds: readonly string[];
  readonly isChanged: boolean;
  /** The changes to send along with a save. */
  readonly operations: LinkOperations;
  readonly add: (sourceId: string, target: LinkCandidate) => void;
  readonly remove: (linkId: string) => void;
  /** Takes the working links as the new baseline after a save. */
  readonly commit: (links: readonly WorkingLink[]) => void;
}

function isPendingLink(link: WorkingLink): boolean {
  return link.id.startsWith(PENDING_LINK_PREFIX);
}

/**
 * Keeps the outgoing dependencies the milestone panel edits.
 *
 * @remarks
 * A new revert token for this milestone, which a failed save hands over, makes
 * the panel fall back to the links the server has. A token that exists
 * already when the panel opens belongs to an earlier save and is ignored.
 *
 * @param outgoingLinks - The dependencies of the milestone as the server has
 * them; they are the baseline.
 * @param revertToken - Latest failure of a save, if any.
 * @param milestoneId - The milestone the panel edits, `null` when creating.
 */
export function usePanelLinks(
  outgoingLinks: readonly WorkingLink[],
  revertToken: RevertToken | null,
  milestoneId: string | null,
): PanelLinksState {
  const [baselineLinks, setBaselineLinks] =
    useState<readonly WorkingLink[]>(outgoingLinks);
  const [workingLinks, setWorkingLinks] =
    useState<readonly WorkingLink[]>(outgoingLinks);
  const [removedLinkIds, setRemovedLinkIds] = useState<readonly string[]>([]);
  const [seenToken, setSeenToken] = useState(revertToken?.token ?? 0);

  if (
    revertToken !== null &&
    revertToken.milestoneId === milestoneId &&
    revertToken.token !== seenToken
  ) {
    setSeenToken(revertToken.token);
    setWorkingLinks(revertToken.links);
    setBaselineLinks(revertToken.links);
    setRemovedLinkIds([]);
  }

  const addedLinks = workingLinks.filter(isPendingLink);
  const keptLinks = workingLinks.filter((link) => !isPendingLink(link));
  const baselineSignature = [
    ...baselineLinks.map((link) => link.id),
    ...removedLinkIds,
  ]
    .sort()
    .join("|");
  const workingSignature = [
    ...keptLinks.map((link) => link.id),
    ...addedLinks.map((link) => link.targetId),
  ]
    .sort()
    .join("|");

  function add(sourceId: string, target: LinkCandidate): void {
    setWorkingLinks((current) => [
      ...current,
      {
        id: `${PENDING_LINK_PREFIX}${sourceId}-${target.id}`,
        linkType: MILESTONE_LINK_TYPE.PREREQUISITE,
        targetHex: target.hex,
        targetIcon: target.icon,
        targetId: target.id,
        targetName: target.name,
      },
    ]);
  }

  function remove(linkId: string): void {
    setWorkingLinks((current) => current.filter((link) => link.id !== linkId));

    if (!linkId.startsWith(PENDING_LINK_PREFIX)) {
      setRemovedLinkIds((current) => [...current, linkId]);
    }
  }

  function commit(links: readonly WorkingLink[]): void {
    setBaselineLinks(links);
    setRemovedLinkIds([]);
  }

  return {
    add,
    commit,
    isChanged: baselineSignature !== workingSignature,
    operations: {
      added: addedLinks.map((link) => ({
        linkType: link.linkType,
        targetId: link.targetId,
      })),
      removedIds: removedLinkIds,
    },
    remove,
    removedLinkIds,
    workingLinks,
  };
}
