import { useTranslation } from "react-i18next";

import type { AgentPlanSessionRecord } from "@/definition/AgentPlanSession";

function useRequestedRows(
  session: AgentPlanSessionRecord,
): readonly (readonly [string, string])[] {
  const { t } = useTranslation();
  const { requested } = session;
  const yesNo = (value: boolean): string =>
    t(value ? "plans.session.yes" : "plans.session.no");
  const options = requested.options
    ? t("plans.session.optionsValue", {
        access: t(`plans.session.access.${requested.options.access}`),
        shell: yesNo(requested.options.shell),
        web: yesNo(requested.options.web),
        duration:
          requested.options.timeoutMinutes === 0
            ? t("settings.agents.run.unlimited")
            : t("settings.agents.run.hardTimeout", {
                minutes: requested.options.timeoutMinutes,
              }),
      })
    : "—";
  return [
    [t("plans.session.connection"), requested.connectionName],
    [t("plans.session.model"), requested.model],
    [t("plans.session.reasoning"), requested.reasoningEffort ?? "—"],
    [t("plans.session.options"), options],
    [t("plans.session.unattended"), requested.unattended],
    [t("plans.session.mcp"), yesNo(requested.mcp)],
    [t("plans.session.directory"), requested.directory ?? "—"],
    [
      t("plans.session.definition"),
      session.definition
        ? t("plans.session.definitionValue", session.definition)
        : "—",
    ],
  ];
}

function Rows({
  rows,
}: {
  readonly rows: readonly (readonly [string, string])[];
}): React.ReactElement {
  return (
    <dl className="grid grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-[auto_1fr]">
      {rows.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-muted-foreground">{label}</dt>
          <dd className="pages-selectable break-all">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Shows the configuration Pages requested and what the runner reported, without secrets. */
export function PlanRunConfiguration({
  session,
}: {
  readonly session: AgentPlanSessionRecord;
}): React.ReactElement {
  const { t } = useTranslation();
  const requested = useRequestedRows(session);
  const effective = Object.entries(session.effective ?? {}).filter(
    ([, value]) => value !== "",
  );
  return (
    <details className="text-xs">
      <summary className="cursor-pointer font-medium">
        {t("plans.session.configuration")}
      </summary>
      <div className="mt-1 space-y-2">
        <h4 className="font-medium">{t("plans.session.requested")}</h4>
        <Rows rows={requested} />
        <h4 className="font-medium">{t("plans.session.effective")}</h4>
        {effective.length > 0 ? (
          <Rows rows={effective} />
        ) : (
          <p className="text-muted-foreground">—</p>
        )}
      </div>
    </details>
  );
}
