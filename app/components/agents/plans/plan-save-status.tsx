import {
  Check,
  Circle,
  LoaderCircle,
  LockKeyhole,
  TriangleAlert,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { useNavigation } from "react-router";

import { cn } from "@/app/lib/cn";

import type { usePlanEditor } from "./use-plan-editor";

type SaveState =
  "loading" | "readOnly" | "saving" | "failed" | "unsaved" | "saved";

function saveState(editor: ReturnType<typeof usePlanEditor>): SaveState {
  if (!editor.canEdit) return "readOnly";
  if (editor.isPending) return "saving";
  if (
    editor.command.data?.ok === false &&
    editor.command.data.intent === "save-plan"
  )
    return "failed";
  return editor.isDirty || editor.draft.revision === undefined
    ? "unsaved"
    : "saved";
}

/** Save feedback describes the draft separately from the selected run's execution status. */
export function PlanSaveStatus({
  editor,
}: {
  readonly editor: ReturnType<typeof usePlanEditor>;
}): React.ReactElement {
  const { t } = useTranslation();
  const navigation = useNavigation();
  const state = navigation.state === "loading" ? "loading" : saveState(editor);
  const Icon = {
    loading: LoaderCircle,
    readOnly: LockKeyhole,
    saving: LoaderCircle,
    failed: TriangleAlert,
    unsaved: Circle,
    saved: Check,
  }[state];
  return (
    <span
      role="status"
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full bg-muted px-2 py-1 text-xs text-muted-foreground",
        state === "failed" && "bg-destructive-subtle text-destructive",
      )}
    >
      <Icon
        className={cn(
          "size-3.5",
          (state === "saving" || state === "loading") &&
            "motion-safe:animate-spin",
        )}
        aria-hidden="true"
      />
      {t(`plans.flow.storage.${state}`)}
    </span>
  );
}
