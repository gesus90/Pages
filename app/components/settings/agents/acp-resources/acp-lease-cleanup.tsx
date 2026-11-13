import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useFetcher } from "react-router";

import { Button } from "@/app/components/ui/button";

import { AgentCheckTime } from "../agent-check-time";

import type { SettingsActionData } from "@/app/lib/settings-actions/settings-action-support.server";
import type {
  AcpLeaseCleanupCategory,
  AcpLeaseCleanupEntry,
  AcpLeaseCleanupReport,
} from "@/definition/AcpResource";

const INTENT = "check-acp-leases";
const CATEGORY_ORDER: readonly AcpLeaseCleanupCategory[] = [
  "releasable",
  "released",
  "kept_active",
  "kept_unproven",
  "check_failed",
];

interface AcpLeaseCleanupProps {
  /** Reloads the resource view with the stored state after a cleanup. */
  readonly onCleaned: () => void;
}

/** One reservation of a preview or result, with its reason and next step. */
function CleanupEntry({
  entry,
}: {
  readonly entry: AcpLeaseCleanupEntry;
}): React.ReactElement {
  const { t } = useTranslation();
  return (
    <li className="space-y-1 rounded-md border border-border p-2">
      <p>
        {t(`settings.agents.providerShort.${entry.provider}`)} ·{" "}
        {entry.runId === null
          ? t("settings.agents.resources.entry.pica")
          : t("settings.agents.resources.entry.planUnknown")}{" "}
        · {t("settings.agents.resources.entry.age")}{" "}
        <AgentCheckTime checkedAt={entry.since} />
      </p>
      <p className="text-muted-foreground">
        {t(`settings.agents.resources.reason.${entry.reason}`, {
          instance: entry.instanceId,
        })}
      </p>
      <p className="text-xs break-all text-muted-foreground">
        {t("settings.agents.resources.entry.instance")}: {entry.instanceId}
        {entry.runId
          ? ` · ${t("settings.agents.resources.entry.run")}: ${entry.runId}`
          : ""}
      </p>
    </li>
  );
}

/** The reservations of one category, collapsed behind their count. */
function CleanupCategory({
  category,
  entries,
}: {
  readonly category: AcpLeaseCleanupCategory;
  readonly entries: readonly AcpLeaseCleanupEntry[];
}): React.ReactElement | null {
  const { t } = useTranslation();
  if (entries.length === 0) return null;
  return (
    <details className="rounded-md border border-border p-2">
      <summary className="cursor-pointer">
        {t(`settings.agents.resources.cleanup.category.${category}`, {
          count: entries.length,
        })}
      </summary>
      <ul className="mt-2 space-y-2">
        {entries.map((entry) => (
          <CleanupEntry key={entry.instanceId} entry={entry} />
        ))}
      </ul>
    </details>
  );
}

/** Counts per category and the reservations behind each, as the server classified them. */
function CleanupReport({
  report,
}: {
  readonly report: AcpLeaseCleanupReport;
}): React.ReactElement {
  const { t } = useTranslation();
  const isPreview = report.mode === "preview";
  return (
    <div className="space-y-2" role="status" aria-live="polite">
      <p className="font-medium">
        {t(
          `settings.agents.resources.cleanup.${isPreview ? "previewTitle" : "resultTitle"}`,
          { count: report.entries.length },
        )}{" "}
        <AgentCheckTime checkedAt={report.at} />
      </p>
      <p>
        {CATEGORY_ORDER.filter((category) => report.counts[category] > 0)
          .map((category) =>
            t(`settings.agents.resources.cleanup.category.${category}`, {
              count: report.counts[category],
            }),
          )
          .join(" · ") || t("settings.agents.resources.cleanup.empty")}
      </p>
      {isPreview && report.counts.releasable === 0 ? (
        <p className="text-muted-foreground">
          {t("settings.agents.resources.cleanup.nothing")}
        </p>
      ) : null}
      {report.scope === "all" ? null : (
        <p className="text-muted-foreground">
          {t(`settings.agents.resources.cleanup.scope.${report.scope}`)}
        </p>
      )}
      {CATEGORY_ORDER.map((category) => (
        <CleanupCategory
          key={category}
          category={category}
          entries={report.entries.filter(
            (entry) => entry.category === category,
          )}
        />
      ))}
    </div>
  );
}

/** Reports a server-confirmed cleanup once, so the view reloads the stored state. */
function useCleanedNotice(
  outcome: SettingsActionData | null,
  onCleaned: () => void,
): void {
  const lastCleaned = useRef<SettingsActionData | null>(null);
  useEffect(() => {
    if (
      outcome?.intent !== INTENT ||
      !outcome.ok ||
      outcome.report.mode !== "cleanup" ||
      lastCleaned.current === outcome
    )
      return;
    lastCleaned.current = outcome;
    onCleaned();
  }, [outcome, onCleaned]);
}

/**
 * The administrator's check of ACP reservations with a preview and a
 * confirmed cleanup (PAGE-340).
 *
 * @remarks
 * The server decides everything: the preview only classifies, and the
 * confirmation releases exactly the previewed reservations that are still
 * proven ended when it checks them again. Nothing is ended or signalled.
 */
export function AcpLeaseCleanup({
  onCleaned,
}: AcpLeaseCleanupProps): React.ReactElement {
  const { t } = useTranslation();
  const fetcher = useFetcher<SettingsActionData>({ key: "acp-lease-cleanup" });
  const outcome = fetcher.data?.intent === INTENT ? fetcher.data : null;
  const isBusy = fetcher.state !== "idle";
  const report = outcome?.ok === true ? outcome.report : null;
  const releasable =
    report?.mode === "preview"
      ? report.entries.filter((entry) => entry.category === "releasable")
      : [];
  useCleanedNotice(outcome, onCleaned);

  function handlePreview(): void {
    void fetcher.submit(
      { intent: INTENT, mode: "preview" },
      { method: "post", action: "/settings/system" },
    );
  }

  function handleConfirm(): void {
    const formData = new FormData();
    formData.set("intent", INTENT);
    formData.set("mode", "cleanup");
    for (const entry of releasable)
      formData.append("instanceId", entry.instanceId);
    void fetcher.submit(formData, {
      method: "post",
      action: "/settings/system",
    });
  }

  return (
    <section
      aria-label={t("settings.agents.resources.cleanup.title")}
      aria-busy={isBusy}
      className="space-y-2 rounded-md border border-border p-3"
    >
      <p className="font-medium">
        {t("settings.agents.resources.cleanup.title")}
      </p>
      <p className="text-muted-foreground">
        {t("settings.agents.resources.cleanup.hint")}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          disabled={isBusy}
          onClick={handlePreview}
        >
          {t(
            `settings.agents.resources.cleanup.${isBusy ? "running" : "preview"}`,
          )}
        </Button>
        {releasable.length > 0 ? (
          <Button type="button" disabled={isBusy} onClick={handleConfirm}>
            {t("settings.agents.resources.cleanup.confirm", {
              count: releasable.length,
            })}
          </Button>
        ) : null}
      </div>
      {outcome?.ok === false ? (
        <p role="alert" className="text-destructive">
          {t(`settings.agents.resources.cleanup.error.${outcome.error}`)}
        </p>
      ) : null}
      {report ? <CleanupReport report={report} /> : null}
    </section>
  );
}
