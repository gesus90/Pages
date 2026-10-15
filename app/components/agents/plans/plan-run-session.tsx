import { ExternalLink } from "lucide-react";
import { useTranslation } from "react-i18next";

import { useRegionFormatter } from "@/app/components/common/region-provider";

import { PlanRunConfiguration } from "./plan-run-configuration";
import { PlanRunContract } from "./plan-run-contract";

import type { AgentPlanSessionRecord } from "@/definition/AgentPlanSession";

interface SessionFact {
  readonly label: string;
  readonly value: string;
}

/** Seconds between two stored times, or `null` while one is missing. */
function secondsBetween(
  start: string | null,
  end: string | null,
): number | null {
  if (start === null || end === null) return null;
  return Math.max(0, (Date.parse(end) - Date.parse(start)) / 1000);
}

function useSessionFacts(
  session: AgentPlanSessionRecord,
): readonly SessionFact[] {
  const { t } = useTranslation();
  const { formatDateTime } = useRegionFormatter();
  const time = (value: string | null): string =>
    value === null ? "—" : formatDateTime(value);
  const exit =
    session.exit === null
      ? "—"
      : t("plans.session.exitValue", {
          code: session.exit.code ?? "—",
          signal: session.exit.signal ?? "—",
        });
  return [
    { label: t("plans.session.instance"), value: session.instanceId },
    { label: t("plans.session.sessionId"), value: session.sessionId ?? "—" },
    {
      label: t("plans.session.process"),
      value: session.processId === null ? "—" : String(session.processId),
    },
    { label: t("plans.session.started"), value: time(session.startedAt) },
    { label: t("plans.session.turnEnded"), value: time(session.turnEndedAt) },
    { label: t("plans.session.ended"), value: time(session.endedAt) },
    {
      label: t("plans.session.duration"),
      value: t("plans.session.durationValue", {
        turn:
          secondsBetween(session.startedAt, session.turnEndedAt)?.toFixed(1) ??
          "—",
        total:
          secondsBetween(session.startedAt, session.endedAt)?.toFixed(1) ?? "—",
      }),
    },
    { label: t("plans.session.exit"), value: exit },
    {
      label: t("plans.session.closeoutLabel"),
      value: t(`plans.session.closeout.${session.closeout}`, {
        count: session.leftoverProcesses ?? 0,
      }),
    },
  ];
}

/** Shows what ran for one node: runner, session, process, closeout and the Pages result. */
export function PlanRunSession({
  runId,
  stepId,
  session,
  requiresAcceptance = false,
}: {
  readonly runId: string;
  readonly stepId: string;
  readonly session: AgentPlanSessionRecord;
  readonly requiresAcceptance?: boolean;
}): React.ReactElement {
  const { t } = useTranslation();
  const facts = useSessionFacts(session);
  const result =
    session.resultCode === null
      ? t("plans.session.resultPending")
      : String(session.resultCode);
  return (
    <section
      className="mt-2 space-y-2 border-t border-border pt-2"
      aria-label={t("plans.session.title")}
    >
      <p className="text-sm">
        <span className="font-medium">
          {t(`plans.session.runner.${session.runner}`)}
        </span>{" "}
        · {t(`plans.session.mode.${session.mode}`)} ·{" "}
        {t("plans.session.result")}{" "}
        <span
          className={
            session.resultCode === -1 ? "text-destructive" : "font-medium"
          }
        >
          {result}
        </span>
      </p>
      <dl className="grid grid-cols-1 gap-x-4 gap-y-1 text-xs sm:grid-cols-[auto_1fr]">
        {facts.map((fact) => (
          <div key={fact.label} className="contents">
            <dt className="text-muted-foreground">{fact.label}</dt>
            <dd className="pages-selectable break-all">{fact.value}</dd>
          </div>
        ))}
      </dl>
      <a
        href={`/agent-api/plan-runs/${encodeURIComponent(runId)}/steps/${encodeURIComponent(stepId)}/prompt`}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1 text-xs font-medium text-primary underline-offset-4 hover:underline"
      >
        {t("plans.session.prompt")}
        <ExternalLink className="size-3" aria-hidden="true" />
      </a>
      <PlanRunConfiguration session={session} />
      {session.contract ? (
        <PlanRunContract
          contract={session.contract}
          acceptance={session.acceptance}
          requiresAcceptance={requiresAcceptance}
        />
      ) : null}
      {session.events.length > 0 ? (
        <details className="text-xs">
          <summary className="cursor-pointer font-medium">
            {t("plans.session.events")}
          </summary>
          <ol className="pages-selectable mt-1 space-y-0.5 text-muted-foreground">
            {session.events.map((event, index) => (
              <li key={`${index}:${event}`} className="break-words">
                {event}
              </li>
            ))}
          </ol>
        </details>
      ) : null}
    </section>
  );
}
