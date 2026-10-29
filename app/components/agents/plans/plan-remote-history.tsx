import { useTranslation } from "react-i18next";

import { useAgentSession } from "./plan-agent-console/use-agent-session";

import type { AgentPlanStepResult } from "@/definition/AgentPlan";
import type { AgentSessionKey } from "@/definition/AgentSessionJournal";

/** Explains why an older runner has no remote live history, without blocking its existing execution. */
export function PlanRemoteHistoryNotice({
  step,
}: {
  readonly step: AgentPlanStepResult;
}): React.ReactElement | null {
  const { t } = useTranslation();
  if (
    step.execution?.target.kind !== "remote" ||
    !step.session ||
    !["codex_cli", "claude_code", "opencode", "antigravity"].includes(
      step.session.runner,
    ) ||
    step.remote?.outputJournalVersion === 2
  )
    return null;
  return (
    <p
      role="status"
      className="rounded-lg bg-muted p-3 text-xs leading-4.5 text-muted-foreground wrap-anywhere"
    >
      {t("plans.console.outputUpgrade")}
    </p>
  );
}

/** A short live excerpt in the run detail; the console retains the complete bounded history. */
export function PlanRemoteHistory({
  step,
}: {
  readonly step: AgentPlanStepResult;
}): React.ReactElement | null {
  const execution = step.execution;
  if (
    !execution ||
    step.remote?.liveHistoryVersion !== 1 ||
    !step.session?.attemptId
  )
    return <PlanRemoteHistoryNotice step={step} />;
  const sessionKey: AgentSessionKey = {
    planId: execution.planId,
    runId: execution.runId,
    stepId: step.id,
    attemptId: step.session.attemptId,
  };
  return (
    <RemoteHistoryExcerpt
      key={step.session.attemptId}
      sessionKey={sessionKey}
      step={step}
    />
  );
}

function RemoteHistoryExcerpt({
  sessionKey,
  step,
}: {
  readonly sessionKey: AgentSessionKey;
  readonly step: AgentPlanStepResult;
}): React.ReactElement {
  const { t } = useTranslation();
  const session = useAgentSession(sessionKey, {
    isLive: true,
    status: step.status,
    isRemote: true,
  });
  const events = session.events.slice(-8);
  return (
    <section className="mt-4 space-y-2 border-t border-border/80 pt-3">
      <h4 className="font-semibold">{t("plans.console.remoteHistory")}</h4>
      <p className="text-muted-foreground">
        {t("plans.console.remoteDiagnostic")}
      </p>
      {session.error ? (
        <p role="status" className="text-destructive">
          {t([
            `settings.agents.error.${session.error}`,
            "settings.agents.error.general",
          ])}
        </p>
      ) : null}
      {!events.length ? (
        <p role="status" className="text-muted-foreground">
          {t(
            session.connection === "loading"
              ? "plans.console.loading"
              : "plans.console.noEvents",
          )}
        </p>
      ) : (
        <ol className="space-y-2">
          {events.map((event) => (
            <li
              key={event.id}
              className="rounded-md bg-muted p-2 wrap-anywhere"
            >
              <p className="font-medium text-muted-foreground">
                {t(`plans.console.kind.${event.kind}`)}
              </p>
              <p className="mt-1 whitespace-pre-wrap">
                {event.text.slice(0, 500)}
                {event.text.length > 500 ? "…" : ""}
              </p>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
