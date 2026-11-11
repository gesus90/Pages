import { Button } from "@/app/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/app/components/ui/dialog";

import { StatusText } from "./automation-chips";
import { nameOf } from "./automation-labels";
import { runSummaryText, runTone } from "./automation-run-summary";
import { formatDuration, formatRunMoment } from "./automation-time-format";
import { useAutomationRun } from "./use-automation-run";

import type { AutomationRunDetail } from "@/definition/Automation";
import type { ReactNode } from "react";
import type { AutomationsPageState } from "./use-automations-page";

/** A titled block of the dialog. */
function RunSection({
  title,
  children,
}: {
  readonly title: string;
  readonly children: ReactNode;
}): React.ReactElement {
  return (
    <section className="flex flex-col gap-1.5">
      <h3 className="text-xs text-muted-foreground">{title}</h3>
      {children}
    </section>
  );
}

/** Preformatted text such as output or trigger data. */
function RunText({ text }: { readonly text: string }): React.ReactElement {
  return (
    <pre className="pages-selectable max-h-60 overflow-auto rounded-xl bg-muted px-3 py-2.5 font-mono text-xs leading-relaxed whitespace-pre-wrap text-foreground">
      {text}
    </pre>
  );
}

/** The outputs and deliveries of a loaded run. */
function RunDetailBody({
  detail,
  page,
}: {
  readonly detail: AutomationRunDetail;
  readonly page: AutomationsPageState;
}): React.ReactElement {
  const { context } = page;
  const { t } = context;
  const automation = page.pageData.automations.find(
    (entry) => entry.id === detail.automationId,
  );
  return (
    <div className="mt-4 flex flex-col gap-4 text-sm">
      <StatusText
        tone={runTone(detail)}
        text={`${runSummaryText({ run: detail, automation, place: "panel" }, context)} · ${formatDuration(detail.duration, t)}`}
      />
      {detail.answer ? (
        <RunSection title={t("automations.run.answer")}>
          <RunText text={detail.answer} />
        </RunSection>
      ) : null}
      {detail.output ? (
        <RunSection title={t("automations.run.output")}>
          <RunText text={detail.output} />
        </RunSection>
      ) : null}
      {detail.error ? (
        <RunSection title={t("automations.run.error")}>
          <RunText text={detail.error} />
        </RunSection>
      ) : null}
      {detail.triggerData ? (
        <RunSection title={t("automations.run.triggerData")}>
          <RunText text={JSON.stringify(detail.triggerData, null, 2)} />
        </RunSection>
      ) : null}
      <RunSection title={t("automations.run.deliveries")}>
        {detail.deliveries.length === 0 ? (
          <p className="text-muted-foreground">
            {t("automations.run.noDeliveries")}
          </p>
        ) : (
          <ul className="flex flex-col gap-1">
            {detail.deliveries.map((delivery) => (
              <li
                key={`${delivery.agentId}-${delivery.kind}-${delivery.queuedAt}`}
              >
                {nameOf(context, delivery.agentId)} ·{" "}
                {t(`automations.run.kinds.${delivery.kind}`)} ·{" "}
                <span className="font-medium">
                  {t(`automations.run.states.${delivery.state}`)}
                </span>
                {delivery.errorCode ? ` · ${delivery.errorCode}` : null}
              </li>
            ))}
          </ul>
        )}
      </RunSection>
    </div>
  );
}

/** The dialog of one run with its answer, output, error, trigger data and deliveries. */
export function AutomationRunDialog({
  page,
}: {
  readonly page: AutomationsPageState;
}): React.ReactElement {
  const { t } = page.context;
  const { openRun, setOpenRun } = page.selection;
  const state = useAutomationRun(openRun);
  const run = page.pageData.history.find(
    (entry) => entry.runId === openRun?.runId,
  );
  const title =
    state.detail?.automationName ??
    run?.automationName ??
    t("automations.run.title");
  const moment = state.detail ?? run;

  function handleOpenChange(isOpen: boolean): void {
    if (!isOpen) setOpenRun(null);
  }

  return (
    <Dialog open={openRun !== null} onOpenChange={handleOpenChange}>
      <DialogContent size="lg">
        <DialogTitle className="text-lg font-semibold">{title}</DialogTitle>
        <DialogDescription className="mt-1 text-sm text-muted-foreground">
          {moment
            ? formatRunMoment(moment.startedAt ?? moment.queuedAt, page.context)
            : t("automations.run.title")}
        </DialogDescription>
        {state.isLoading ? (
          <p className="mt-4 text-sm text-muted-foreground" role="status">
            {t("automations.run.loading")}
          </p>
        ) : null}
        {state.hasFailed ? (
          <p className="mt-4 text-sm text-destructive" role="alert">
            {t("automations.run.failed")}
          </p>
        ) : null}
        {state.detail ? (
          <RunDetailBody detail={state.detail} page={page} />
        ) : null}
        <footer className="mt-6 flex justify-end">
          <Button onClick={() => setOpenRun(null)} variant="ghost">
            {t("automations.run.close")}
          </Button>
        </footer>
      </DialogContent>
    </Dialog>
  );
}
