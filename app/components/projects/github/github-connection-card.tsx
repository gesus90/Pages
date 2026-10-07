import { Form } from "react-router";
import { useTranslation } from "react-i18next";

import { GitHubSyncSwitch } from "@/app/components/projects/github/github-sync-switch";
import { Button } from "@/app/components/ui/button";
import { cn } from "@/app/lib/cn";

import type { ProjectIntegration } from "@/definition/Project";

interface DetailRowProps {
  readonly label: string;
  readonly value: string;
  readonly isStrong?: boolean;
}

function DetailRow({
  label,
  value,
  isStrong = false,
}: DetailRowProps): React.ReactElement {
  return (
    <div className="flex gap-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd
        className={
          isStrong ? "font-medium text-foreground" : "text-muted-foreground"
        }
      >
        {value}
      </dd>
    </div>
  );
}

function IntentButton({
  intent,
  label,
  className,
  disabled = false,
}: {
  readonly intent: string;
  readonly label: string;
  readonly className: string;
  readonly disabled?: boolean;
}): React.ReactElement {
  return (
    <Form method="post">
      <input name="intent" type="hidden" value={intent} />
      <Button
        className={className}
        disabled={disabled}
        type="submit"
        variant="ghost"
      >
        {label}
      </Button>
    </Form>
  );
}

/** The connection state, sync times and the sync and disconnect actions. */
export function GitHubConnectionCard({
  integration,
}: {
  readonly integration: ProjectIntegration;
}): React.ReactElement {
  const { t } = useTranslation();

  return (
    <section className="flex flex-col gap-3 rounded-2xl bg-muted/40 p-4">
      <p className="flex items-center gap-2 text-xs font-semibold text-foreground">
        <span
          aria-hidden="true"
          className={cn(
            "size-2 rounded-full",
            integration.isConnected ? "bg-emerald-500" : "bg-muted-foreground",
          )}
        />
        {integration.isConnected
          ? t("projectDetail.integrations.connected")
          : t("projectDetail.integrations.notConnected")}
      </p>
      <dl className="flex flex-col gap-1.5 text-xs">
        <DetailRow
          isStrong
          label={t("projectDetail.integrations.repository")}
          value={integration.repoName ?? "—"}
        />
        <DetailRow
          label={t("projectDetail.integrations.lastSync")}
          value={
            integration.lastSyncAt ?? t("projectDetail.integrations.never")
          }
        />
        <DetailRow
          label={t("projectDetail.integrations.nextSync")}
          value={
            integration.nextSyncAt ??
            t("projectDetail.integrations.intervalManual")
          }
        />
      </dl>
      <GitHubSyncSwitch isEnabled={integration.syncEnabled} />
      <div className="flex flex-wrap gap-2">
        {integration.isConnected ? (
          <IntentButton
            className="h-8 px-3 text-xs"
            disabled={!integration.syncEnabled}
            intent="sync-integration"
            label={t("projectDetail.integrations.syncNow")}
          />
        ) : null}
        <IntentButton
          className="h-8 px-3 text-xs text-destructive hover:text-destructive"
          intent="disconnect-integration"
          label={t("projectDetail.integrations.disconnect")}
        />
      </div>
    </section>
  );
}
