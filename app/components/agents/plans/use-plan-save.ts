import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { showSuccessToast } from "@/app/components/ui/toast";

import { usePlanSaveShortcut } from "./use-plan-save-shortcut";

import type { usePlanEditor } from "./use-plan-editor";

/** What the editor tells about the save the person asked for. */
export type PlanSaveFeedback =
  | { readonly kind: "saving" }
  | { readonly kind: "readOnly" }
  | { readonly kind: "failed"; readonly error: string };

/** The answer to the last save, once it arrived. */
function saveResult(
  editor: ReturnType<typeof usePlanEditor>,
): "saved" | { readonly error: string } | null {
  const result = editor.command.data;
  if (editor.isSaving || result?.intent !== "save-plan") return null;
  return result.ok ? "saved" : { error: result.error };
}

/**
 * Saves the plan with Ctrl+S or Cmd+S and keeps the answer visible.
 *
 * @remarks
 * Saving stays explicit; an unchanged plan is not stored again. A stored plan
 * is confirmed by the document toast as soon as the server answered; a
 * refusal of a save the person asked for with the button or the keyboard
 * stays until it is closed or the next save succeeds. Ctrl+S during a save
 * waits for that save instead of being ignored.
 */
export function usePlanSave(
  editor: ReturnType<typeof usePlanEditor>,
  hasPlan: boolean,
): {
  readonly feedback: PlanSaveFeedback | null;
  readonly dismiss: () => void;
} {
  const { t } = useTranslation();
  const [isReadOnlyShown, setReadOnlyShown] = useState(false);
  const [dismissed, setDismissed] = useState(editor.command.data);
  const handled = useRef(editor.command.data);
  const result = saveResult(editor);
  const isSaved = result === "saved";
  useEffect(() => {
    const answer = editor.command.data;
    if (!isSaved || answer === handled.current) return;
    handled.current = answer;
    showSuccessToast(t("plans.saved"));
  }, [isSaved, editor.command.data, t]);
  usePlanSaveShortcut(() => {
    if (!hasPlan || (editor.isPending && !editor.isSaving)) return;
    if (!editor.canEdit) {
      setReadOnlyShown(true);
      return;
    }
    setReadOnlyShown(false);
    if (editor.isDirty || editor.graph.hasPendingMove()) editor.save();
    else showSuccessToast(t("plans.saved"));
  });
  let feedback: PlanSaveFeedback | null = null;
  if (isReadOnlyShown) feedback = { kind: "readOnly" };
  if (editor.isExplicitSave && editor.isSaving) feedback = { kind: "saving" };
  if (
    editor.isExplicitSave &&
    result !== null &&
    result !== "saved" &&
    editor.command.data !== dismissed
  )
    feedback = { kind: "failed", error: result.error };
  return {
    feedback,
    dismiss: () => {
      setReadOnlyShown(false);
      setDismissed(editor.command.data);
    },
  };
}
