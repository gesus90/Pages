import { useEffect } from "react";
import { useFetcher } from "react-router";
import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/app/components/ui/dialog";

import { planRequestError } from "./plan-context-model";

import type { AgentPlanView } from "@/definition/AgentPlan";
import type { AgentPlanAuditEntry } from "@/definition/AgentPlanTeam";
import type { usePlanManagement } from "./use-plan-management";

/** What the history request answers. */
type PlanHistoryResult =
  | { readonly ok: true; readonly entries: readonly AgentPlanAuditEntry[] }
  | { readonly ok: false; readonly error: string };

/** Reads the history of the plan once the dialog opens. */
function usePlanHistory(planId: string): {
  readonly entries: readonly AgentPlanAuditEntry[] | null;
  readonly error: string | null;
} {
  const fetcher = useFetcher<PlanHistoryResult>();
  const { submit } = fetcher;
  useEffect(() => {
    void submit(
      { intent: "plan-history", planId },
      { method: "post", action: "/agents/plans" },
    );
  }, [submit, planId]);
  const result = fetcher.state === "idle" ? fetcher.data : undefined;
  if (!result) return { entries: null, error: null };
  return result.ok
    ? { entries: result.entries, error: null }
    : { entries: null, error: result.error };
}

/**
 * The history of the plan (PAGE-329): who changed teams or owner, who
 * approved which script hash, and every action of an administrator on a plan
 * of somebody else, newest first.
 */
export function PlanHistoryDialog({
  plan,
  management,
}: {
  readonly plan: AgentPlanView;
  readonly management: ReturnType<typeof usePlanManagement>;
}): React.ReactElement {
  const { t, i18n } = useTranslation();
  const history = usePlanHistory(plan.id);
  const format = new Intl.DateTimeFormat(i18n.language, {
    dateStyle: "medium",
    timeStyle: "short",
  });
  return (
    <Dialog
      open
      onOpenChange={(isOpen) => {
        if (!isOpen) management.close();
      }}
    >
      <DialogContent size="md" className="space-y-4">
        <DialogTitle className="text-lg font-semibold">
          {t("plans.access.historyTitle")}
        </DialogTitle>
        <DialogDescription className="text-sm text-muted-foreground">
          {t("plans.access.historyDescription", { name: plan.name })}
        </DialogDescription>
        {history.error ? (
          <p role="alert" className="text-xs text-destructive">
            {planRequestError(history.error, t)}
          </p>
        ) : null}
        {history.entries === null && !history.error ? (
          <p className="text-xs text-muted-foreground">
            {t("plans.access.historyLoading")}
          </p>
        ) : null}
        {history.entries?.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            {t("plans.access.historyEmpty")}
          </p>
        ) : null}
        <ol className="max-h-96 space-y-2 overflow-y-auto" data-plan-history>
          {history.entries?.map((entry) => (
            <li
              key={entry.id}
              className="rounded-xl bg-muted px-3 py-2 text-xs"
              data-plan-history-action={entry.action}
            >
              <p className="font-semibold">
                {t(`plans.access.action.${entry.action}`, {
                  name: entry.actorName,
                })}
              </p>
              <p className="text-muted-foreground">
                {t("plans.access.historyMeta", {
                  time: format.format(new Date(entry.createdAt)),
                  revision: entry.revision,
                })}
                {typeof entry.details.contentHash === "string"
                  ? ` · ${entry.details.contentHash.slice(0, 12)}`
                  : null}
              </p>
            </li>
          ))}
        </ol>
        <div className="flex justify-end">
          <DialogClose asChild>
            <Button variant="outline">{t("plans.manage.close")}</Button>
          </DialogClose>
        </div>
      </DialogContent>
    </Dialog>
  );
}
