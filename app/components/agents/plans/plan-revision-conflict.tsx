import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/app/components/ui/dialog";

import { PlanReloadButton } from "./plan-reload-button";

import type { usePlanEditor } from "./use-plan-editor";

/** A concurrent save refuses this one and preserves the draft; nothing was overwritten. */
export function PlanRevisionConflict(props: {
  readonly editor: ReturnType<typeof usePlanEditor>;
}): React.ReactElement {
  const { t } = useTranslation();
  const result = props.editor.command.data;
  const [dismissed, dismiss] = useState<typeof result>(undefined);
  const isOpen =
    result?.ok === false &&
    result.error === "plan_conflict" &&
    result !== dismissed;
  return (
    // Without a trigger the dialog only ever asks to close.
    <Dialog open={isOpen} onOpenChange={() => dismiss(result)}>
      <DialogContent
        size="lg"
        overlayClassName="bg-transparent"
        className="space-y-4"
      >
        <DialogTitle className="text-lg font-semibold">
          {t("plans.execution.conflictTitle")}
        </DialogTitle>
        <DialogDescription className="text-sm text-muted-foreground">
          {t("plans.execution.conflictHint")}
        </DialogDescription>
        <section className="space-y-1 rounded-xl border border-border p-3 text-xs">
          <h3 className="font-semibold">{t("plans.execution.draftChange")}</h3>
          <p className="text-muted-foreground">{props.editor.draft.name}</p>
        </section>
        <section className="space-y-1 rounded-xl border border-border p-3 text-xs">
          <h3 className="font-semibold">{t("plans.execution.savedPlan")}</h3>
          <p className="text-muted-foreground">
            {t("plans.execution.conflictPreserved")}
          </p>
        </section>
        <footer className="flex justify-end gap-2 border-t border-border pt-4">
          <Button variant="outline" size="sm" onClick={() => dismiss(result)}>
            {t("settings.agents.cancel")}
          </Button>
          <PlanReloadButton />
        </footer>
      </DialogContent>
    </Dialog>
  );
}
