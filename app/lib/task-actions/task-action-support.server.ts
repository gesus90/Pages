import { data } from "react-router";

import { GitHubApiError } from "@/backend/github/GitHubApiClient";
import {
  WorkItemAccessDeniedError,
  WorkItemHierarchyError,
  WorkItemNotFoundError,
  WorkItemValidationError,
} from "@/backend/error/WorkItemErrors";

import type { ApplicationServices } from "@/app/lib/services.server";
import type { User } from "@/definition/User";

/** Every ticket action the task routes understand. */
export type TaskActionIntent =
  | "archive-task"
  | "restore-task"
  | "move-project"
  | "create-task"
  | "move-task"
  | "update-task"
  | "label-create"
  | "label-update"
  | "label-delete"
  | "label-assign"
  | "label-unassign"
  | "checklist-add"
  | "checklist-toggle"
  | "checklist-delete"
  | "link-add"
  | "link-remove"
  | "sync-github-project"
  | "sync-github-task"
  | "github-import-issue"
  | "github-link-issue"
  | "github-dismiss-issue"
  | "github-assign-pr"
  | "github-resolve-conflict";

/** What the client receives after a ticket action. */
type TaskActionResult =
  | {
      readonly ok: true;
      readonly intent: TaskActionIntent;
      readonly key?: string;
    }
  | {
      readonly ok: false;
      readonly intent: TaskActionIntent;
      readonly error: string;
    };

/** The response an action handler returns to React Router. */
export type TaskActionResponse = ReturnType<typeof data<TaskActionResult>>;

/** Everything a ticket action handler needs from the request. */
export interface TaskActionContext {
  readonly actor: User;
  readonly formData: FormData;
  readonly services: ApplicationServices;
}

/** Handles one ticket action. */
export type TaskActionHandler = (
  context: TaskActionContext,
) => Promise<TaskActionResponse>;

/**
 * Answers a ticket action whose form fields are missing or malformed.
 *
 * @param intent - The action that was requested.
 * @returns A `400` response.
 */
export function invalidInput(intent: TaskActionIntent): TaskActionResponse {
  return data<TaskActionResult>(
    { error: "invalidInput", intent, ok: false },
    { status: 400 },
  );
}

/**
 * Runs the service call of a ticket action that has nothing to show.
 *
 * @param intent - The action being run.
 * @param work - Calls the service; its result is ignored.
 * @returns A success response, or the failure `handleTaskActionError` maps.
 */
export async function runTaskAction(
  intent: TaskActionIntent,
  work: () => Promise<unknown>,
): Promise<TaskActionResponse> {
  try {
    await work();

    return data<TaskActionResult>({ intent, ok: true });
  } catch (error: unknown) {
    return handleTaskActionError(error, intent);
  }
}

/**
 * Runs the service call of a ticket action whose ticket the client shows.
 *
 * @param intent - The action being run.
 * @param work - Calls the service; returns the affected ticket.
 * @returns A success response with the ticket key, or the failure
 * `handleTaskActionError` maps.
 */
export async function runTicketAction(
  intent: TaskActionIntent,
  work: () => Promise<{ readonly key: string }>,
): Promise<TaskActionResponse> {
  try {
    const ticket = await work();

    return data<TaskActionResult>({ intent, key: ticket.key, ok: true });
  } catch (error: unknown) {
    return handleTaskActionError(error, intent);
  }
}

/**
 * Maps the failures a ticket action may end in to client responses.
 *
 * @param error - The failure thrown by a service.
 * @param intent - The action that failed.
 * @returns The response describing the failure.
 * @throws The original error when it is not one the client should see.
 */
function handleTaskActionError(
  error: unknown,
  intent: TaskActionIntent,
): TaskActionResponse {
  if (error instanceof WorkItemAccessDeniedError) {
    return data<TaskActionResult>(
      { error: "forbidden", intent, ok: false },
      { status: 403 },
    );
  }

  if (error instanceof WorkItemNotFoundError) {
    return data<TaskActionResult>(
      { error: "notFound", intent, ok: false },
      { status: 404 },
    );
  }

  if (
    error instanceof WorkItemHierarchyError ||
    error instanceof WorkItemValidationError
  ) {
    return data<TaskActionResult>(
      { error: error.message, intent, ok: false },
      { status: 400 },
    );
  }

  if (error instanceof GitHubApiError) {
    return data<TaskActionResult>(
      { error: "githubSyncFailed", intent, ok: false },
      {
        status: error.status >= 400 && error.status <= 599 ? error.status : 502,
      },
    );
  }

  throw error;
}
