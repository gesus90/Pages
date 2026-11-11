import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { useRegionFormat } from "@/app/components/common/region-provider";
import { showSuccessToast } from "@/app/components/ui/toast";
import { createRandomUuid } from "@/app/lib/random-uuid";

import { useAutomationActions } from "./use-automation-actions";
import { useAutomationEditor } from "./use-automation-editor";
import { useAutomationSelection } from "./use-automation-selection";
import { useNow } from "./use-now";

import type { Automation } from "@/definition/Automation";
import type { AutomationPageData } from "@/definition/AutomationPage";
import type { LabelContext } from "./automation-time-format";
import type {
  AutomationActionFailure,
  AutomationActionSuccess,
  AutomationActions,
} from "./use-automation-actions";
import type { AutomationEditor } from "./use-automation-editor";
import type { AutomationSelection } from "./use-automation-selection";

/** Everything the sections of the page share. */
export interface AutomationsPageState {
  readonly pageData: AutomationPageData;
  readonly context: LabelContext;
  readonly selection: AutomationSelection;
  readonly editor: AutomationEditor;
  readonly actions: AutomationActions;
  /** Whether the panel replaces the table on narrow screens. */
  readonly isDetailOpen: boolean;
  readonly closeDetail: () => void;
  readonly selectRow: (automation: Automation) => void;
  readonly toggleActive: (automation: Automation) => void;
  readonly runNow: (automation: Automation) => void;
  readonly deleteTarget: Automation | null;
  readonly askDelete: (automation: Automation) => void;
  readonly cancelDelete: () => void;
  readonly confirmDelete: () => void;
}

function needsNewTime(automation: Automation, now: Date): boolean {
  if (automation.trigger.type !== "once") return false;
  const at = automation.trigger.at;
  return at === null || new Date(at).getTime() <= now.getTime();
}

/** Without a receipt status: "Lauf vorgemerkt" when a run is still under way, else "Lauf angenommen". */
function runToastKey(automation: Automation | null): "queued" | "accepted" {
  const status = automation?.lastRun?.status;
  const isPending =
    status === "queued" || status === "accepted" || status === "delivered";
  return isPending ? "queued" : "accepted";
}

/** The identity every change of an existing automation carries. */
function revisionFields(automation: Automation): {
  readonly operationId: string;
  readonly automationId: string;
  readonly expectedRevision: number;
} {
  return {
    operationId: createRandomUuid(),
    automationId: automation.id,
    expectedRevision: automation.revision,
  };
}

/** The texts, language, zone, clock and names every label uses. */
function useLabelContext(pageData: AutomationPageData): LabelContext {
  const { t, i18n } = useTranslation();
  const region = useRegionFormat();
  const now = useNow(pageData.readAt);
  return {
    t,
    language: i18n.language,
    timeZone: region.timeZone,
    now,
    names: pageData.names,
  };
}

/**
 * The state of the automation page: tab, selection, editor, the changes
 * it sends and the reactions to their answers.
 */
export function useAutomationsPage(
  pageData: AutomationPageData,
): AutomationsPageState {
  const context = useLabelContext(pageData);
  const { t, now } = context;
  const selection = useAutomationSelection(pageData);
  const [deleteTarget, setDeleteTarget] = useState<Automation | null>(null);
  const toggled = useRef<Automation | null>(null);
  const runTarget = useRef<Automation | null>(null);
  const actions = useAutomationActions({
    onSuccess: handleSuccess,
    onFailure: handleFailure,
  });
  const editor = useAutomationEditor({
    options: pageData.options,
    now,
    submit: actions.submit,
  });

  function handleSuccess(result: AutomationActionSuccess): void {
    if (result.intent === "run") {
      showSuccessToast(
        t(
          `automations.toast.${result.runStatus ?? runToastKey(runTarget.current)}`,
        ),
      );
      return;
    }
    if (result.intent === "delete") {
      setDeleteTarget(null);
      selection.select(null);
      editor.close();
      return;
    }
    if (result.intent === "create" && result.automation)
      selection.reveal(result.automation);
    if (result.intent !== "setActive") editor.close();
  }

  function handleFailure(failure: AutomationActionFailure): void {
    if (failure.reason !== "time_required") return;
    const automation = toggled.current;
    if (failure.intent === "setActive" && automation) {
      selection.reveal(automation);
      editor.startEdit(automation, true);
      return;
    }
    editor.markTime("activate");
  }

  function selectRow(automation: Automation): void {
    if (editor.mode !== "view") editor.close();
    actions.dismissFailure();
    selection.select(automation.id);
  }

  function toggleActive(automation: Automation): void {
    const isActive = !automation.isActive;
    toggled.current = automation;
    if (isActive && needsNewTime(automation, now)) {
      actions.dismissFailure();
      selection.reveal(automation);
      editor.startEdit(automation, true);
      return;
    }
    actions.submit("setActive", { ...revisionFields(automation), isActive });
  }

  function runNow(automation: Automation): void {
    runTarget.current = automation;
    actions.submit("run", revisionFields(automation));
  }

  function confirmDelete(): void {
    if (!deleteTarget) return;
    actions.submit("delete", {
      ...revisionFields(deleteTarget),
      confirmed: true,
    });
  }

  function closeDetail(): void {
    editor.close();
    actions.dismissFailure();
    selection.select(null);
  }

  return {
    pageData,
    context,
    selection,
    editor,
    actions,
    isDetailOpen: selection.hasSelection || editor.mode !== "view",
    closeDetail,
    selectRow,
    toggleActive,
    runNow,
    deleteTarget,
    askDelete: (automation) => {
      actions.dismissFailure();
      setDeleteTarget(automation);
    },
    cancelDelete: () => setDeleteTarget(null),
    confirmDelete,
  };
}
