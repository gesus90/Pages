import {
  useNavigate,
  useNavigation,
  useSearchParams,
  useSubmit,
} from "react-router";

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

/** What is being submitted and the functions that change the archive filter or move a ticket. */
export interface TasksPage {
  readonly isArchiving: boolean;
  readonly isSyncing: boolean;
  readonly isSubmittingForm: boolean;
  readonly changeArchived: (value: string) => void;
  readonly moveTask: (
    taskId: string,
    targetStatusId: string,
    sortOrder: number,
  ) => void;
}

/** Reports what the tasks page is submitting and keeps its archive filter in the address. */
export function useTasksPage(): TasksPage {
  const navigation = useNavigation();
  const navigate = useNavigate();
  const submit = useSubmit();
  const [searchParams] = useSearchParams();

  return {
    changeArchived: (value) => {
      const params = new URLSearchParams(searchParams);

      params.set("archived", value);
      void navigate(`?${params.toString()}`);
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
  };
}
