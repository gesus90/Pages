import { useState } from "react";
import { useActionData } from "react-router";

import type { action } from "@/app/routes/tasks";
import type { TaskActionErrorCode } from "@/app/lib/task-actions/task-action-support.server";

/** The reason the last label action failed, and the way to stop showing it. */
export interface LabelFailure {
  readonly error: TaskActionErrorCode | null;
  readonly dismiss: () => void;
}

/**
 * Reports why the last label action failed.
 *
 * @remarks
 * The failure stays until another action answers or the dialog closes, so
 * reopening the dialog does not show the answer to an earlier attempt.
 */
export function useLabelFailure(): LabelFailure {
  const actionData = useActionData<typeof action>();
  const [dismissed, setDismissed] = useState<unknown>(null);

  function dismiss(): void {
    setDismissed(actionData);
  }

  if (
    !actionData ||
    actionData.ok ||
    !actionData.intent.startsWith("label-") ||
    actionData === dismissed
  ) {
    return { dismiss, error: null };
  }

  return { dismiss, error: actionData.error };
}
