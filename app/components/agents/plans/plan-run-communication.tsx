import { useTranslation } from "react-i18next";

import type { AgentPlanStepResult } from "@/definition/AgentPlan";

interface PlanRunCommunicationProps {
  readonly step: AgentPlanStepResult;
}

const ACTIVE_STATES = ["queued", "accepted", "running"];

/** Separates the last confirmed process state, current transport health and pending stop delivery. */
export function PlanRunCommunication({
  step,
}: PlanRunCommunicationProps): React.ReactElement | null {
  const { t } = useTranslation();
  const remote = step.remote;
  if (step.execution?.target.kind !== "remote") return null;
  if (!remote) return <p role="status">{t("plans.communication.unknown")}</p>;
  const contact = remote.contact;
  const rows = [
    ["confirmed", t(`plans.communication.status.${remote.status}`)],
    [
      "connection",
      t(`plans.communication.connectionState.${contact?.state ?? "unknown"}`),
    ],
    ["contact", contact?.lastContactAt ?? t("plans.communication.unknown")],
    ["observed", remote.observedAt ?? t("plans.communication.unknown")],
    ["job", remote.jobId],
    ["attempt", step.execution.attemptId],
    ["session", remote.sessionId],
  ];
  return (
    <section
      role="status"
      className="space-y-2 rounded-lg bg-muted p-3 text-xs"
    >
      <h4 className="font-semibold">{t("plans.communication.title")}</h4>
      <dl className="space-y-1">
        {rows.map(([name, content]) => (
          <div key={name} className="wrap-anywhere">
            <dt className="text-muted-foreground">
              {t(`plans.communication.${name}`)}
            </dt>
            <dd>{content}</dd>
          </div>
        ))}
      </dl>
      {remote.queueReason ? (
        <p>{t(`plans.communication.queue.${remote.queueReason}`)}</p>
      ) : null}
      <PlanStopProgress remote={remote} />
      <PlanLivenessNotice remote={remote} />
    </section>
  );
}

/** A lost channel and a quiet worker on a live channel leave the process state unknown for different reasons. */
function PlanLivenessNotice({
  remote,
}: {
  readonly remote: NonNullable<AgentPlanStepResult["remote"]>;
}): React.ReactElement | null {
  const { t } = useTranslation();
  if (remote.contact?.state === "connected")
    return remote.isObservationStale ? (
      <p>{t("plans.communication.workerStale")}</p>
    ) : null;
  return ACTIVE_STATES.includes(remote.status) ? (
    <p>{t("plans.communication.disconnected")}</p>
  ) : null;
}

/** A stored request, its delivery and the confirmed end are three separate facts. */
function PlanStopProgress({
  remote,
}: {
  readonly remote: NonNullable<AgentPlanStepResult["remote"]>;
}): React.ReactElement | null {
  const { t } = useTranslation();
  if (remote.status === "interrupted")
    return (
      <p>
        {t(
          remote.closeout === "confirmed"
            ? "plans.communication.stopConfirmed"
            : "plans.communication.stopUnconfirmed",
        )}
      </p>
    );
  if (!remote.cancellation || !ACTIVE_STATES.includes(remote.status))
    return null;
  return (
    <p>
      {t(
        remote.cancellation.receivedAt
          ? "plans.communication.stopReceived"
          : "plans.communication.stopPending",
      )}
    </p>
  );
}
