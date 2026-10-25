import { Paperclip } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link, useFetcher } from "react-router";

import { Button } from "@/app/components/ui/button";
import { SettingsCard } from "@/app/components/settings/settings-layout";

import type { TicketAssetAudit } from "@/definition/TicketAssetAudit";

/** Explicit, read-only inventory of broken ticket image references and storage inconsistencies. */
export function TicketAssetsCard(): React.ReactElement {
  const { t } = useTranslation();
  const fetcher = useFetcher<TicketAssetAudit>();
  const report = fetcher.data;

  return (
    <SettingsCard
      className="min-w-0 scroll-mt-28"
      icon={<Paperclip aria-hidden="true" className="size-4" />}
      title={t("settings.ticketAssets.title")}
      description={t("settings.ticketAssets.description")}
    >
      <Button
        className="mt-3"
        disabled={fetcher.state !== "idle"}
        onClick={() => void fetcher.load("/settings-api/ticket-assets")}
        type="button"
        variant="outline"
      >
        {t(
          fetcher.state === "idle"
            ? "settings.ticketAssets.check"
            : "settings.ticketAssets.checking",
        )}
      </Button>
      {report ? (
        <div className="mt-3 text-sm" aria-live="polite">
          <p className="text-muted-foreground">
            {t("settings.ticketAssets.summary", {
              tickets: report.ticketCount,
              attachments: report.attachmentCount,
              findings: report.findings.length,
            })}
          </p>
          {report.findings.length === 0 ? (
            <p className="mt-2 text-foreground">
              {t("settings.ticketAssets.healthy")}
            </p>
          ) : (
            <ul className="mt-3 flex max-h-96 flex-col gap-3 overflow-y-auto">
              {report.findings.map((finding, index) => (
                <li
                  className="rounded-lg bg-muted/40 p-3"
                  key={`${finding.ticketId}:${index}`}
                >
                  <Link
                    className="font-medium text-primary hover:underline"
                    to={`/tasks/${finding.ticketKey}`}
                  >
                    {finding.ticketKey}
                  </Link>
                  <p className="mt-1 text-foreground">
                    {t(`settings.ticketAssets.reason.${finding.reason}`)}
                  </p>
                  <p className="mt-1 break-all text-xs text-muted-foreground">
                    {finding.reference}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </SettingsCard>
  );
}
