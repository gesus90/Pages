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

/** A persistent decision for a newer revision; keeping edits leaves optimistic locking intact. */
export function PlanIncomingRevision(props: {
  readonly editor: ReturnType<typeof usePlanEditor>;
}): React.ReactElement | null {
  const { t } = useTranslation();
  const { editor } = props;
  const [isConfirming, setConfirming] = useState(false);
  if (!editor.incomingRevision) return null;
  return (
    <section
      role="status"
      className="pointer-events-auto rounded-xl border border-border bg-background p-3 text-sm shadow-sm"
    >
      <p>
        {t("plans.execution.incomingRevision", {
          revision: editor.incomingRevision,
        })}
      </p>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setConfirming(true)}
        disabled={editor.isPending || editor.graph.isMoving}
      >
        {t("plans.flow.storage.reload")}
      </Button>
      <Dialog open={isConfirming} onOpenChange={setConfirming}>
        <DialogContent className="space-y-4">
          <DialogTitle>{t("plans.execution.conflictTitle")}</DialogTitle>
          <DialogDescription>
            {t("plans.execution.incomingDiscard")}
          </DialogDescription>
          <footer className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setConfirming(false)}>
              {t("settings.agents.cancel")}
            </Button>
            <Button
              disabled={editor.isPending || editor.graph.isMoving}
              onClick={() => {
                editor.adoptIncoming();
                setConfirming(false);
              }}
            >
              {t("plans.flow.storage.reload")}
            </Button>
          </footer>
        </DialogContent>
      </Dialog>
    </section>
  );
}

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
