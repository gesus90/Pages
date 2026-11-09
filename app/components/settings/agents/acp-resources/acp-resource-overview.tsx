import { useTranslation } from "react-i18next";

import type { AcpResourceDiagnostics } from "@/definition/AcpResource";

function countBy<Item>(
  items: readonly Item[],
  matches: (item: Item) => boolean,
): number {
  return items.filter(matches).length;
}

/** Separates reserved capacity, proven process activity, waiting requests and measured host RAM. */
export function AcpResourceOverview({
  resources,
}: {
  readonly resources: AcpResourceDiagnostics;
}): React.ReactElement {
  const { t } = useTranslation();
  const { active, waiting, options } = resources;
  const limit =
    options.maxConcurrentAcpSessions === 0
      ? t("settings.agents.resources.unlimited")
      : options.maxConcurrentAcpSessions;
  const capacityWaiting = countBy(
    waiting,
    (entry) => entry.reason === "capacity",
  );
  return (
    <div className="space-y-1">
      <p role="status" aria-live="polite" aria-atomic="true">
        {t("settings.agents.resources.summary", {
          active: active.length,
          unconfirmed: countBy(
            active,
            (entry) => entry.state === "cleanup_failed",
          ),
          limit,
          waiting: waiting.length,
        })}
      </p>
      <p>
        {t("settings.agents.resources.processes", {
          confirmed: countBy(active, (entry) => entry.process === "confirmed"),
          none: countBy(active, (entry) => entry.process === "none"),
          unknown: countBy(
            active,
            (entry) => (entry.process ?? "unknown") === "unknown",
          ),
        })}
      </p>
      <p className="text-muted-foreground">
        {t("settings.agents.resources.processesHint")}
      </p>
      <p className="text-muted-foreground">
        {waiting.length === 0
          ? t("settings.agents.resources.waitingNone")
          : t("settings.agents.resources.waitingSome", {
              count: waiting.length,
              capacity: capacityWaiting,
            })}
      </p>
      <p className="text-muted-foreground">
        {t(`settings.agents.resources.source.${resources.limitSource}`)}
      </p>
      <p className="text-muted-foreground">
        {resources.availableMemory === null
          ? t("settings.agents.resources.ramUnknown", {
              reserve: options.minimumAvailableMemory,
            })
          : t("settings.agents.resources.ram", {
              available: Math.floor(resources.availableMemory),
              reserve: options.minimumAvailableMemory,
            })}{" "}
        ·{" "}
        {t(
          `settings.agents.resources.${options.memoryAwareScheduling ? "memoryEnabled" : "memoryDisabled"}`,
        )}
      </p>
    </div>
  );
}
