import { useTranslation } from "react-i18next";

import { PlanAssetEntry } from "./plan-asset-entry";

import type { AgentPlanStepResult } from "@/definition/AgentPlan";

/** Shows the frozen resource versions and Pages-owned transmission/access evidence. */
export function PlanRemoteAccessDetails({
  step,
}: {
  readonly step: AgentPlanStepResult;
}): React.ReactElement | null {
  const { t } = useTranslation();
  const resources = step.execution?.resources ?? [];
  const access = step.resourceAccess;
  const errorKey =
    step.error === "parameter_ticket_changed"
      ? "plans.remoteAccess.referencesChanged"
      : `settings.agents.error.${step.error}`;
  if (resources.length === 0 && !access && !step.assetFailure) return null;
  return (
    <section className="mt-3 space-y-3 border-t border-border pt-3">
      {step.assetFailure ? (
        <p role="alert" className="text-destructive wrap-anywhere">
          {t("plans.remoteAccess.assetFailure", {
            ...step.assetFailure,
            cause: t(`settings.agents.error.${step.assetFailure.cause}`),
          })}
        </p>
      ) : null}
      {step.status === "failed" && step.error ? (
        <p role="alert" className="text-destructive wrap-anywhere">
          {t(errorKey, {
            defaultValue: t("settings.agents.error.general"),
          })}
        </p>
      ) : null}
      {resources.length > 0 ? (
        <div>
          <h4 className="font-semibold">{t("plans.remoteAccess.resources")}</h4>
          <ul className="mt-1 space-y-2">
            {resources.map((resource) => (
              <li
                key={`${resource.parameter}-${resource.id}`}
                className="min-w-0 wrap-anywhere"
              >
                <p>
                  {resource.parameter} ·{" "}
                  {t(`plans.remoteAccess.${resource.type}`)} · {resource.name}
                </p>
                <p className="text-muted-foreground">
                  {t("plans.remoteAccess.version", {
                    version: resource.version,
                  })}
                </p>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {access ? (
        <>
          <div>
            <h4 className="font-semibold">{t("plans.remoteAccess.files")}</h4>
            {access.files.length ? (
              <ul className="mt-1 space-y-1">
                {access.files.map((file) => (
                  <PlanAssetEntry
                    key={`${file.parameter}-${file.asset?.id ?? file.name}-${file.digest}`}
                    file={file}
                  />
                ))}
              </ul>
            ) : (
              <p className="text-muted-foreground">
                {t("plans.remoteAccess.noFiles")}
              </p>
            )}
          </div>
          <div>
            <h4 className="font-semibold">{t("plans.remoteAccess.pages")}</h4>
            <p className="text-muted-foreground">
              {t(`plans.remoteAccess.${access.pages}`)}
            </p>
            <ul className="mt-1 space-y-1">
              {access.events.map((event, index) => (
                <li
                  key={`${event.at}-${index}`}
                  className="min-w-0 wrap-anywhere"
                >
                  {event.tool} · {event.target ?? "—"} ·{" "}
                  {t(`plans.remoteAccess.${event.result}`)}
                  <time
                    className="block text-muted-foreground"
                    dateTime={event.at}
                  >
                    {event.at}
                  </time>
                </li>
              ))}
            </ul>
          </div>
        </>
      ) : null}
    </section>
  );
}
