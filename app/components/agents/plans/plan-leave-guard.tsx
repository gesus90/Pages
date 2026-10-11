import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useBlocker } from "react-router";

import { AgentDiscardDialog } from "@/app/components/settings/agents/agent-discard-dialog";

/** Protects unsaved graphs when choosing another plan, following the sidebar or closing the tab. */
export function PlanLeaveGuard(props: {
  readonly isDirty: boolean;
}): React.ReactElement {
  const { t } = useTranslation();
  const blocker = useBlocker(props.isDirty);
  useEffect(() => {
    if (!props.isDirty) return undefined;
    const warn = (event: BeforeUnloadEvent): void => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [props.isDirty]);
  return (
    <AgentDiscardDialog
      open={blocker.state === "blocked"}
      onOpenChange={(open) => {
        if (!open) blocker.reset?.();
      }}
      onDiscard={() => blocker.proceed?.()}
      title={t("plans.discardTitle")}
      description={t("plans.discardHint")}
    />
  );
}
