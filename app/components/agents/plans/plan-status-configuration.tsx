import { useTranslation } from "react-i18next";

import { elapsedTime } from "./plan-run-status-model";

import type { AgentPlanSessionRecord } from "@/definition/AgentPlanSession";

interface StatusConfigurationProps {
  readonly session: AgentPlanSessionRecord;
  readonly end: string | null;
  readonly isRunning: boolean;
}

function ConfirmedValue({
  requested,
  effective,
}: {
  readonly requested: string | null;
  readonly effective: string | null;
}): React.ReactElement {
  const { t } = useTranslation();
  return (
    <span className="block wrap-anywhere">
      {effective ?? t("plans.progress.notReported")}
      {requested && requested !== effective ? (
        <span className="ml-2 text-xs text-muted-foreground">
          {t("plans.progress.requested", { value: requested })}
        </span>
      ) : null}
    </span>
  );
}

/** Only allowlisted reported fields are shown; requested settings never imply confirmation. */
export function PlanStatusConfiguration({
  session,
  end,
  isRunning,
}: StatusConfigurationProps): React.ReactElement {
  const { t } = useTranslation();
  const effective = session.effective ?? {};
  const permission =
    [effective.sessionMode, effective.sandbox, effective.approvalPolicy]
      .filter(Boolean)
      .join(" · ") || null;
  const isRequest = session.runner === "api";
  const rows: readonly [string, React.ReactNode][] = [
    ["runner", t(`plans.progress.runner.${session.runner}`)],
    [
      "model",
      <ConfirmedValue
        key="model"
        requested={session.requested.model}
        effective={effective.model ?? null}
      />,
    ],
    [
      "reasoning",
      <ConfirmedValue
        key="reasoning"
        requested={session.requested.reasoningEffort}
        effective={effective.reasoningEffort ?? null}
      />,
    ],
    [
      "permissions",
      isRequest ? (
        t("plans.progress.notApplicable")
      ) : (
        <ConfirmedValue
          key="permissions"
          requested={session.requested.options?.access ?? null}
          effective={permission}
        />
      ),
    ],
    [
      "directory",
      isRequest ? (
        t("plans.progress.notApplicable")
      ) : (
        <ConfirmedValue
          key="directory"
          requested={session.requested.directory}
          effective={effective.workspace ?? null}
        />
      ),
    ],
    [
      "stepTime",
      elapsedTime(
        session.startedAt,
        session.turnEndedAt ?? session.endedAt ?? (isRunning ? end : null),
      ),
    ],
  ];
  return (
    <section>
      <h4 className="mb-2 text-base font-semibold">
        {t("plans.progress.configuration")}
      </h4>
      <dl className="grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)] gap-x-4 gap-y-0.5 text-sm @3xl:grid-cols-[minmax(0,10rem)_minmax(0,1fr)]">
        {rows.map(([name, content]) => (
          <div className="contents" key={name}>
            <dt className="wrap-anywhere text-muted-foreground">
              {t(`plans.progress.field.${name}`)}
            </dt>
            <dd className="min-w-0 wrap-anywhere">{content}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
