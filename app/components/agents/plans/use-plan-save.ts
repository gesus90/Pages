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
  if (editor.isPending || result?.intent !== "save-plan") return null;
  return result.ok ? "saved" : { error: result.error };
}

/**
 * Saves the plan with Ctrl+S or Cmd+S and keeps the answer visible.
 *
 * @remarks
 * Saving stays explicit; an unchanged plan is not stored again. A stored plan
 * is confirmed by the document toast; a refusal stays until it is closed or
 * the next save succeeds.
 */
export function usePlanSave(
  editor: ReturnType<typeof usePlanEditor>,
  hasPlan: boolean,
): {
  readonly feedback: PlanSaveFeedback | null;
  readonly dismiss: () => void;
} {
  const { t } = useTranslation();
  const [request, setRequest] = useState<"save" | "readOnly" | null>(null);
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
    if (!hasPlan || editor.isPending) return;
    if (!editor.canEdit) {
      setRequest("readOnly");
      return;
    }
    setRequest("save");
    if (editor.isDirty || editor.graph.hasPendingMove()) editor.save();
    else showSuccessToast(t("plans.saved"));
  });
  let feedback: PlanSaveFeedback | null = null;
  if (request === "readOnly") feedback = { kind: "readOnly" };
  if (request === "save" && editor.isPending) feedback = { kind: "saving" };
  if (request === "save" && result !== null && result !== "saved")
    feedback = { kind: "failed", error: result.error };
  return { feedback, dismiss: () => setRequest(null) };
}
