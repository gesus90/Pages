import {
  useActionData,
  useFetcher,
  useLocation,
  useNavigation,
  useSubmit,
} from "react-router";

import type { action } from "@/app/routes/tasks";
import type { WorkItemDetail } from "@/definition/Task";

function readFailure(answer: unknown): string | null {
  return typeof answer === "object" &&
    answer !== null &&
    "ok" in answer &&
    answer.ok === false &&
    "error" in answer &&
    typeof answer.error === "string"
    ? answer.error
    : null;
}

/** Submits a parent choice with its previously displayed value. */
export function useTicketParentSubmission(ticket: WorkItemDetail): {
  readonly failure: string | null;
  readonly isSubmitting: boolean;
  readonly change: (parentId: string) => void;
} {
  const fetcher = useFetcher();
  const submit = useSubmit();
  const location = useLocation();
  const navigation = useNavigation();
  const outcome = useActionData<typeof action>();
  const isBoardOverlay =
    (location.pathname === "/aufgaben" || location.pathname === "/tasks") &&
    new URLSearchParams(location.search).has("item");
  const isSubmitting = isBoardOverlay
    ? navigation.formData?.get("intent") === "change-parent"
    : fetcher.state !== "idle";
  let failure: string | null = null;
  if (isBoardOverlay && outcome?.intent === "change-parent") {
    failure = readFailure(outcome);
  } else if (!isBoardOverlay && fetcher.state === "idle") {
    failure = readFailure(fetcher.data);
  }

  function change(parentId: string): void {
    const fields = {
      baseParentId: ticket.parentId ?? "",
      boardLocal: "true",
      id: ticket.id,
      intent: "change-parent",
      parentId,
    };
    if (isBoardOverlay) void submit(fields, { method: "post" });
    else void fetcher.submit(fields, { action: "/aufgaben", method: "post" });
  }

  return { change, failure, isSubmitting };
}
