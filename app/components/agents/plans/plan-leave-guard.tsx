import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useBlocker } from "react-router";

import { AgentDiscardDialog } from "@/app/components/settings/agents/agent-discard-dialog";

/** Protects unsaved graphs when choosing another plan, following the sidebar or closing the tab. */
export function PlanLeaveGuard(props: {
  readonly isDirty: boolean;
}): React.ReactElement {
  const { t } = useTranslation();
  const blocker = useBlocker(
    ({ nextLocation }) => props.isDirty && !isCreatedClone(nextLocation),
  );
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

/** The successful clone action already chose to open this exact saved copy. */
function isCreatedClone(location: {
  readonly pathname: string;
  readonly search: string;
  readonly state: unknown;
}): boolean {
  const { state } = location;
  return (
    location.pathname === "/agents/plans" &&
    typeof state === "object" &&
    state !== null &&
    "clonedPlanId" in state &&
    typeof state.clonedPlanId === "string" &&
    new URLSearchParams(location.search).get("planId") === state.clonedPlanId
  );
}
