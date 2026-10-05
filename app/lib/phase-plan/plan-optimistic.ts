import { serverTimestamp } from "@/app/lib/phase-plan/plan-dates";
import { getMilestoneTime } from "@/app/lib/phase-plan/plan-milestones";

import type {
  DatedMilestone,
  LinkOperations,
  PanelDraft,
} from "@/app/lib/phase-plan/plan-types";
import type { Milestone, MilestoneDependency } from "@/definition/Task";

/** Local changes shown immediately, until the server data replaces them. */
export interface OptimisticState {
  readonly patches: ReadonlyMap<string, Milestone>;
  readonly pending: readonly Milestone[];
  readonly removedIds: ReadonlySet<string>;
  readonly addedLinks: readonly MilestoneDependency[];
  readonly removedLinkIds: ReadonlySet<string>;
}

/** The state without any local change. */
export const EMPTY_OPTIMISTIC_STATE: OptimisticState = {
  addedLinks: [],
  patches: new Map(),
  pending: [],
  removedIds: new Set(),
  removedLinkIds: new Set(),
};

/** A change of the optimistic state. */
export type OptimisticAction =
  | { readonly type: "reset" }
  | {
      readonly type: "patch";
      readonly milestoneId: string;
      readonly milestone: Milestone;
    }
  | { readonly type: "unpatch"; readonly milestoneId: string }
  | { readonly type: "addPending"; readonly milestone: Milestone }
  | { readonly type: "dropPending"; readonly tempId: string }
  | { readonly type: "remove"; readonly milestoneId: string }
  | { readonly type: "restore"; readonly milestoneId: string }
  | {
      readonly type: "addLinks";
      readonly links: readonly MilestoneDependency[];
    }
  | { readonly type: "dropPendingLinks"; readonly milestoneId: string }
  | { readonly type: "removeLinks"; readonly linkIds: readonly string[] }
  | { readonly type: "restoreLinks" };

/** Applies one change to the optimistic state. */
export function optimisticReducer(
  state: OptimisticState,
  action: OptimisticAction,
): OptimisticState {
  switch (action.type) {
    case "reset":
      return EMPTY_OPTIMISTIC_STATE;
    case "patch":
      return {
        ...state,
        patches: new Map(state.patches).set(
          action.milestoneId,
          action.milestone,
        ),
      };
    case "unpatch": {
      const patches = new Map(state.patches);

      patches.delete(action.milestoneId);

      return { ...state, patches };
    }
    case "addPending":
      return { ...state, pending: [...state.pending, action.milestone] };
    case "dropPending":
      return {
        ...state,
        pending: state.pending.filter(
          (milestone) => milestone.id !== action.tempId,
        ),
      };
    case "remove":
      return {
        ...state,
        removedIds: new Set(state.removedIds).add(action.milestoneId),
      };
    case "restore": {
      const removedIds = new Set(state.removedIds);

      removedIds.delete(action.milestoneId);

      return { ...state, removedIds };
    }
    case "addLinks":
      return { ...state, addedLinks: [...state.addedLinks, ...action.links] };
    case "dropPendingLinks":
      return {
        ...state,
        addedLinks: state.addedLinks.filter(
          (link) => !link.id.startsWith(`pending-link-${action.milestoneId}-`),
        ),
      };
    case "removeLinks":
      return {
        ...state,
        removedLinkIds: new Set([...state.removedLinkIds, ...action.linkIds]),
      };
    case "restoreLinks":
      return { ...state, removedLinkIds: new Set() };
  }
}

/** The milestones and dependencies as the visitor currently sees them. */
export interface EffectiveData {
  readonly milestones: readonly Milestone[];
  readonly links: readonly MilestoneDependency[];
}

/**
 * Overlays the local changes on the data the server sent.
 *
 * @param milestones - Milestones from the loader.
 * @param links - Dependencies from the loader.
 * @param state - Local changes that the server has not confirmed yet.
 * @returns The data to show; dependencies of vanished milestones are dropped.
 */
export function applyOptimisticState(
  milestones: readonly Milestone[],
  links: readonly MilestoneDependency[],
  state: OptimisticState,
): EffectiveData {
  const effective = milestones
    .filter((milestone) => !state.removedIds.has(milestone.id))
    .map((milestone) => state.patches.get(milestone.id) ?? milestone)
    .concat(state.pending);
  const effectiveIds = new Set(effective.map((milestone) => milestone.id));
  const isVisible = (link: MilestoneDependency): boolean =>
    effectiveIds.has(link.sourceId) && effectiveIds.has(link.targetId);

  return {
    links: links
      .filter((link) => !state.removedLinkIds.has(link.id) && isVisible(link))
      .concat(state.addedLinks.filter(isVisible)),
    milestones: effective,
  };
}

/** Splits milestones into those with a position on the timeline and the rest. */
export function splitDated(milestones: readonly Milestone[]): {
  readonly dated: readonly DatedMilestone[];
  readonly undated: readonly Milestone[];
} {
  const dated: DatedMilestone[] = [];
  const undated: Milestone[] = [];

  for (const milestone of milestones) {
    const time = getMilestoneTime(milestone);

    if (time === null) {
      undated.push(milestone);
    } else {
      dated.push({ milestone, time });
    }
  }

  return { dated, undated };
}

/** Builds the form a milestone save posts to the server. */
export function buildSaveFormData(
  draft: PanelDraft,
  milestoneId: string | null,
  linkOps: LinkOperations | null,
): FormData {
  const formData = new FormData();

  formData.set("intent", "save-milestone");
  formData.set("name", draft.name);
  formData.set("startAt", draft.start);
  formData.set("dueAt", draft.end);
  formData.set("description", draft.description);
  formData.set("colorKey", draft.color);
  formData.set("customColor", draft.custom ?? "");
  formData.set("iconKey", draft.icon ?? "");
  formData.set("status", draft.status);

  if (milestoneId !== null) {
    formData.set("milestoneId", milestoneId);
  }

  if (linkOps !== null) {
    formData.set(
      "addLinks",
      JSON.stringify(
        linkOps.added.map((added) => ({
          linkType: added.linkType,
          targetId: added.targetId,
        })),
      ),
    );
    formData.set("removeLinks", JSON.stringify(linkOps.removedIds));
  }

  return formData;
}

/** Copies the draft onto a milestone, as shown while the save is running. */
export function withDraft(milestone: Milestone, draft: PanelDraft): Milestone {
  return {
    ...milestone,
    colorCustom: draft.custom,
    colorKey: draft.color,
    description: draft.description.trim(),
    dueAt: draft.end || null,
    iconKey: draft.icon,
    name: draft.name.trim(),
    startAt: draft.start || null,
    status: draft.status,
  };
}

/** Creates the placeholder shown for a milestone the server has not stored. */
export function createPendingMilestone(
  draft: PanelDraft,
  tempId: string,
): Milestone {
  return withDraft(
    {
      archivedAt: null,
      completedAt: null,
      createdAt: serverTimestamp(),
      description: "",
      dueAt: null,
      id: tempId,
      name: "",
      projectId: "",
      startAt: null,
      status: "open",
      updatedAt: serverTimestamp(),
    },
    draft,
  );
}

/** Creates the placeholders shown for dependencies the server has not stored. */
export function createPendingLinks(
  milestone: Milestone,
  added: LinkOperations["added"],
  counter: number,
): MilestoneDependency[] {
  return added.map((link, index) => ({
    createdAt: serverTimestamp(),
    id: `pending-link-${milestone.id}-${counter}-${index}`,
    linkType: link.linkType,
    projectId: milestone.projectId,
    sourceId: milestone.id,
    targetId: link.targetId,
  }));
}
