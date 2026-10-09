import { useTranslation } from "react-i18next";

import { useRegionFormatter } from "@/app/components/common/region-provider";
import { Button } from "@/app/components/ui/button";
import { Select } from "@/app/components/ui/select";
import { CATALOG_INTERVALS } from "@/definition/AgentModelCatalog";

import type { AgentModelCatalog } from "@/definition/AgentModelCatalog";
import type { AgentActions } from "./use-agent-actions";

const CATALOG_TIMES = ["attemptedAt", "refreshedAt", "nextRefreshAt"] as const;

/** Administrative metadata actions do not invoke either diagnostic check. */
export function AgentCatalogControls({
  id,
  catalog,
  actions,
  disabled,
  isCli = false,
}: {
  readonly id: string;
  readonly catalog: AgentModelCatalog;
  readonly actions: AgentActions;
  readonly disabled: boolean;
  /** CLI lists come from the signed-in CLI, not from an API key. */
  readonly isCli?: boolean;
}): React.ReactElement {
  const { t } = useTranslation();
  const { formatDateTime } = useRegionFormatter();
  const state = catalog.errorCode ? "failed" : "ready";
  return (
    <section className="space-y-3">
      <h3 className="text-sm font-semibold">
        {t("settings.agents.catalog.title")}
      </h3>
      <label
        htmlFor="agent-catalog-interval"
        className="block text-sm font-medium"
      >
        {t("settings.agents.catalog.interval")}
      </label>
      <Select
        id="agent-catalog-interval"
        value={String(catalog.intervalHours)}
        options={CATALOG_INTERVALS.map((interval) => ({
          value: String(interval),
          label: t(`settings.agents.catalog.intervals.${interval}`),
        }))}
        ariaLabel={t("settings.agents.catalog.interval")}
        disabled={disabled}
        onValueChange={(intervalHours) =>
          actions.submit("configure-catalog", id, { intervalHours })
        }
      />
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={disabled}
        isPending={actions.pendingIntent === "refresh-catalog"}
        onClick={() => actions.submit("refresh-catalog", id)}
      >
        {t("settings.agents.catalog.refresh")}
      </Button>
      <p className="text-xs text-muted-foreground">
        {t(
          isCli
            ? "settings.agents.catalog.cliHint"
            : "settings.agents.catalog.hint",
        )}
      </p>
      <p role="status" className="text-xs text-muted-foreground">
        {t(
          catalog.attemptedAt
            ? `settings.agents.catalog.${state}`
            : "settings.agents.catalog.never",
        )}
      </p>
      {CATALOG_TIMES.map((key) => {
        const value = catalog[key];
        return value ? (
          <p key={key} className="text-xs text-muted-foreground">
            {t(`settings.agents.catalog.${key}`)}:{" "}
            <time dateTime={value}>{formatDateTime(value)}</time>
          </p>
        ) : null;
      })}
      {catalog.errorCode ? (
        <p role="alert" className="text-xs text-destructive">
          {t(`settings.agents.error.${catalog.errorCode}`)}
        </p>
      ) : null}
    </section>
  );
}
