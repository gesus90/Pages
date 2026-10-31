import { ProjectAccessDeniedError } from "@/backend/error/ProjectErrors";
import { WorkItemNotFoundError } from "@/backend/error/WorkItemErrors";
import { logCaughtError } from "@/backend/logging/Logger";

import type { ApplicationServices } from "@/app/lib/services.server";
import type { GitHubPullRequest } from "@/definition/GitHub";
import type {
  Label,
  WorkItemAttachment,
  WorkItemChecklistItem,
  WorkItemDescendants,
  WorkItemDetail,
  WorkItemHistory,
  WorkItemLink,
} from "@/definition/Task";
import type { User } from "@/definition/User";

/** Detail data for one selected ticket. */
export interface TaskSelection {
  readonly selectedItem: WorkItemDetail | null;
  readonly selectedSubtasks: readonly WorkItemDetail[];
  readonly selectedHistory: readonly WorkItemHistory[];
  readonly selectedPullRequests: readonly GitHubPullRequest[];
  readonly selectedChecklist: readonly WorkItemChecklistItem[];
  readonly selectedLinks: readonly WorkItemLink[];
  readonly selectedAttachments: readonly WorkItemAttachment[];
  readonly selectedDescendants: WorkItemDescendants | null;
}

const NO_SELECTION: TaskSelection = {
  selectedAttachments: [],
  selectedChecklist: [],
  selectedHistory: [],
  selectedItem: null,
  selectedLinks: [],
  selectedPullRequests: [],
  selectedDescendants: null,
  selectedSubtasks: [],
};

/**
 * Loads the ticket the address selects together with everything its panel shows.
 *
 * @param services - Application services the panel data comes from.
 * @param request - Visitor, listed tickets and the selected key. The labels of
 * the listed tickets get the selected ticket's labels added when it lies
 * outside the list.
 */
export async function loadSelection(
  services: ApplicationServices,
  request: {
    readonly actor: User;
    readonly workItems: readonly WorkItemDetail[];
    readonly labelsByWorkItem: Record<string, readonly Label[]>;
    readonly selectedKey: string | null;
  },
): Promise<TaskSelection> {
  const { actor, workItems, labelsByWorkItem, selectedKey } = request;

  if (!selectedKey) {
    return NO_SELECTION;
  }

  const matched =
    workItems.find(
      (item) => item.key === selectedKey || item.id === selectedKey,
    ) ?? (await findSelectedWorkItem(services, actor, selectedKey));

  if (!matched) {
    return NO_SELECTION;
  }

  if (!Object.hasOwn(labelsByWorkItem, matched.id)) {
    const assigned = await services.taskService.findLabelsForWorkItems([
      matched.id,
    ]);

    labelsByWorkItem[matched.id] = assigned.get(matched.id) ?? [];
  }

  return {
    selectedAttachments: await services.taskAttachmentService.list(
      actor,
      matched.id,
    ),
    selectedChecklist: await services.taskService.findChecklistItems(
      actor,
      matched.id,
    ),
    selectedDescendants: await services.taskService.describeDescendants(
      actor,
      matched.id,
    ),
    selectedHistory: await services.taskService.getHistory(actor, matched.id),
    selectedItem: matched,
    selectedLinks: await services.taskService.findLinks(actor, matched.id),
    selectedPullRequests:
      await services.gitHubSyncService.findPullRequestsForTask(
        actor,
        matched.id,
      ),
    selectedSubtasks: await services.taskService.findSubtasks(
      actor,
      matched.id,
    ),
  };
}

/**
 * Resolves a selected ticket outside the current board filter from the database.
 *
 * @param services - Initialized server-side services.
 * @param actor - Authenticated user requesting the ticket.
 * @param selectedKey - Ticket key or id from the query string.
 * @returns The ticket, or `null` when it is missing or inaccessible.
 */
async function findSelectedWorkItem(
  services: ApplicationServices,
  actor: User,
  selectedKey: string,
): Promise<WorkItemDetail | null> {
  try {
    return await services.taskService.getByKey(actor, selectedKey);
  } catch (error: unknown) {
    logCaughtError("tasks", error);

    // Missing or inaccessible tickets simply leave the detail panel closed.
    if (
      error instanceof WorkItemNotFoundError ||
      error instanceof ProjectAccessDeniedError
    ) {
      return null;
    }

    throw error;
  }
}
