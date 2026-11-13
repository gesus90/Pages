import { useEffect, useState } from "react";

import type { AgentPlanInput } from "@/definition/AgentPlan";
import type { usePlanEditor } from "../use-plan-editor";
import type { PlanEditorAccess } from "../use-plan-submission";

/** Saves through the editor and closes once the save is acknowledged. */
export function useEditSave(
  editor: ReturnType<typeof usePlanEditor>,
  onClose: () => void,
): {
  readonly isSubmitted: boolean;
  readonly submit: (
    change: (draft: AgentPlanInput) => AgentPlanInput,
    access: PlanEditorAccess,
  ) => void;
  readonly error: string | null;
} {
  const [isSubmitted, setSubmitted] = useState(false);
  const result = editor.isPending ? undefined : editor.command.data;
  const answer = isSubmitted && result?.intent === "save-plan" ? result : null;
  // A conflicting revision is explained by the editor's conflict dialog instead.
  const isDone =
    answer?.ok === true ||
    (answer?.ok === false && answer.error === "plan_conflict");
  useEffect(() => {
    if (isDone) onClose();
  }, [isDone, onClose]);
  return {
    isSubmitted,
    submit: (change, access) => {
      setSubmitted(true);
      editor.saveWith(change, access);
    },
    error: answer?.ok === false ? answer.error : null,
  };
}
