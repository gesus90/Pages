import { useState } from "react";
import {
  useNavigate,
  useNavigation,
  useSearchParams,
  useSubmit,
} from "react-router";

import type { TasksViewMode } from "@/app/lib/tasks-view";

/** Tells whether a form with one of the intents is being submitted. */
function isSubmittingIntent(
  navigation: ReturnType<typeof useNavigation>,
  ...intents: readonly string[]
): boolean {
  const intent = navigation.formData?.get("intent");

  return (
    navigation.state === "submitting" &&
    typeof intent === "string" &&
    intents.includes(intent)
  );
}

/** The chosen view, the page address it lives in and what is being submitted. */
export interface TasksPage {
  readonly viewMode: TasksViewMode;
  readonly isArchiving: boolean;
  readonly isSyncing: boolean;
  readonly isSubmittingForm: boolean;
  readonly changeView: (view: TasksViewMode) => void;
  readonly changeArchived: (value: string) => void;
  readonly moveTask: (
    taskId: string,
    targetStatusId: string,
    sortOrder: number,
  ) => void;
}

/**
 * Keeps the view of the tasks page in its address and reports what is submitting.
 *
 * @param parseView - Reads a view out of the address.
 */
export function useTasksPage(
  parseView: (value: string | null) => TasksViewMode,
): TasksPage {
  const navigation = useNavigation();
  const navigate = useNavigate();
  const submit = useSubmit();
  const [searchParams] = useSearchParams();
  const [viewMode, setViewMode] = useState<TasksViewMode>(() =>
    parseView(searchParams.get("view")),
  );

  function navigateWith(
    change: (params: URLSearchParams) => void,
    ...options: [{ readonly preventScrollReset: boolean }?]
  ): void {
    const params = new URLSearchParams(searchParams);

    change(params);
    void navigate(`?${params.toString()}`, ...options);
  }

  return {
    changeArchived: (value) =>
      navigateWith((params) => params.set("archived", value)),
    changeView: (nextView) => {
      setViewMode(nextView);
      navigateWith(
        (params) =>
          nextView === "kanban"
            ? params.delete("view")
            : params.set("view", nextView),
        { preventScrollReset: true },
      );
    },
    isArchiving: isSubmittingIntent(navigation, "archive-task", "restore-task"),
    isSubmittingForm: isSubmittingIntent(
      navigation,
      "create-task",
      "update-task",
    ),
    isSyncing: isSubmittingIntent(
      navigation,
      "sync-github-project",
      "sync-github-task",
    ),
    moveTask: (taskId, targetStatusId, sortOrder) => {
      void submit(
        {
          id: taskId,
          intent: "move-task",
          sortOrder: String(sortOrder),
          statusId: targetStatusId,
        },
        { method: "post" },
      );
    },
    viewMode,
  };
}
