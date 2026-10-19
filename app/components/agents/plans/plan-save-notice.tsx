import { LoaderCircle, LockKeyhole, X } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";
import { cn } from "@/app/lib/cn";

import { PlanReloadButton } from "./plan-reload-button";

import type { PlanSaveFeedback } from "./use-plan-save";

function NoticeFrame(props: {
  readonly isAlert: boolean;
  readonly children: React.ReactNode;
  readonly onDismiss?: () => void;
}): React.ReactElement {
  const { t } = useTranslation();
  return (
    <div
      role={props.isAlert ? "alert" : "status"}
      className={cn(
        "pointer-events-auto flex max-w-[min(36rem,calc(100vw-2rem))] items-center gap-2 rounded-lg border bg-surface p-1.5 pl-3 text-sm shadow-xs",
        props.isAlert
          ? "border-destructive/40 text-destructive"
          : "border-border",
      )}
    >
      <div className="flex min-w-0 flex-1 items-center gap-2">
        {props.children}
      </div>
      {props.onDismiss ? (
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label={t("plans.groups.closeNotice")}
          onClick={props.onDismiss}
        >
          <X className="size-4" aria-hidden="true" />
        </Button>
      ) : null}
    </div>
  );
}

/**
 * Tells while a requested save runs, why it was refused and that the plan is read only.
 *
 * @remarks
 * Nothing shows without such a request; the editor keeps no permanent status bar.
 */
export function PlanSaveNotice(props: {
  readonly feedback: PlanSaveFeedback | null;
  readonly onDismiss: () => void;
}): React.ReactElement | null {
  const { t } = useTranslation();
  const { feedback } = props;
  return (
    <>
      {feedback?.kind === "saving" ? (
        <NoticeFrame isAlert={false}>
          <LoaderCircle
            className="size-4 shrink-0 text-muted-foreground motion-safe:animate-spin"
            aria-hidden="true"
          />
          <p className="py-1">{t("plans.flow.storage.saving")}</p>
        </NoticeFrame>
      ) : null}
      {feedback?.kind === "readOnly" ? (
        <NoticeFrame isAlert={false} onDismiss={props.onDismiss}>
          <LockKeyhole
            className="size-4 shrink-0 text-muted-foreground"
            aria-hidden="true"
          />
          <p>{t("plans.flow.storage.readOnly")}</p>
        </NoticeFrame>
      ) : null}
      {feedback?.kind === "failed" ? (
        <NoticeFrame isAlert onDismiss={props.onDismiss}>
          <p className="min-w-0">
            {t("plans.flow.storage.failed")}:{" "}
            {t(`settings.agents.error.${feedback.error}`, {
              defaultValue: t(`agentExecution.error.${feedback.error}`),
            })}
          </p>
          {feedback.error === "plan_conflict" ? <PlanReloadButton /> : null}
        </NoticeFrame>
      ) : null}
    </>
  );
}
