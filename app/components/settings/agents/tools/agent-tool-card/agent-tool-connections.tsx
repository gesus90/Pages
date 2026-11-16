import { useTranslation } from "react-i18next";

import { useRegionFormatter } from "@/app/components/common/region-provider";

import type { AgentToolConnectionView } from "@/definition/AgentTools";

function ConnectionEntry({
  connection,
}: {
  readonly connection: AgentToolConnectionView;
}): React.ReactElement {
  const { t } = useTranslation();
  const { formatDateTime } = useRegionFormatter();
  const isProblem = connection.status !== "ready";
  return (
    <li className="space-y-1 rounded-md border border-border p-2">
      <p className="break-words font-medium">{connection.name}</p>
      <p className={isProblem ? "text-destructive" : "text-muted-foreground"}>
        {t(`agentTools.connections.status.${connection.status}`)}
        {connection.errorCode && connection.status === "failed"
          ? ` (${t(`settings.agents.error.${connection.errorCode}`, {
              defaultValue: connection.errorCode,
            })})`
          : ""}
      </p>
      <p className="text-muted-foreground">
        {t("agentTools.connections.models", {
          count: connection.modelCount,
          date: formatDateTime(connection.catalogRefreshedAt),
        })}
      </p>
      {connection.isCatalogStale ? (
        <p className="text-destructive">
          {t("agentTools.connections.stale", {
            reason: t(
              `settings.agents.error.${connection.catalogErrorCode ?? "general"}`,
              { defaultValue: connection.catalogErrorCode ?? "" },
            ),
          })}
        </p>
      ) : null}
      {connection.missingModel ? (
        <p className="text-destructive">
          {t("agentTools.connections.missingModel", {
            model: connection.missingModel,
          })}
        </p>
      ) : null}
      {connection.missingReasoningEffort ? (
        <p className="text-destructive">
          {t("agentTools.connections.missingEffort", {
            effort: connection.missingReasoningEffort,
          })}
        </p>
      ) : null}
    </li>
  );
}

/**
 * Lists each connection's state after re-binding, with its catalog and any saved choice it lost.
 * @remarks
 * A saved model or reasoning level that the new catalog no longer offers is
 * named, never replaced.
 */
export function AgentToolConnections({
  connections,
}: {
  readonly connections: readonly AgentToolConnectionView[];
}): React.ReactElement {
  const { t } = useTranslation();
  return (
    <section className="space-y-2 text-sm">
      <h4 className="font-medium">{t("agentTools.connections.title")}</h4>
      {connections.length === 0 ? (
        <p className="text-muted-foreground">
          {t("agentTools.connections.empty")}
        </p>
      ) : (
        <ul className="space-y-2">
          {connections.map((connection) => (
            <ConnectionEntry
              key={connection.connectionId}
              connection={connection}
            />
          ))}
        </ul>
      )}
      <p className="text-xs text-muted-foreground">
        {t("agentTools.connections.accountHint")}
      </p>
    </section>
  );
}
