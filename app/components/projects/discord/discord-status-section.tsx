import { useTranslation } from "react-i18next";

import { cn } from "@/app/lib/cn";

import type { DiscordConnection } from "@/definition/Discord";

interface DiscordStatusSectionProps {
  readonly connection: DiscordConnection;
}

interface StatusRowProps {
  readonly label: string;
  readonly value: string;
}

function StatusRow({ label, value }: StatusRowProps): React.ReactElement {
  return (
    <div className="flex gap-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 truncate font-medium text-foreground">{value}</dd>
    </div>
  );
}

/**
 * Shows the connected server and channel and how the deliveries are going.
 *
 * @remarks
 * A delivery problem is explained in words and stays visible until a later
 * message arrived, so a missing permission is noticed without reading a log.
 */
export function DiscordStatusSection({
  connection,
}: DiscordStatusSectionProps): React.ReactElement {
  const { t, i18n } = useTranslation();
  const { delivery } = connection;
  const hasProblem = delivery.lastProblem !== null;

  return (
    <section
      aria-labelledby="discord-status-title"
      className="flex flex-col gap-3 rounded-2xl bg-muted/40 p-4"
    >
      <h3
        className="text-sm font-semibold text-foreground"
        id="discord-status-title"
      >
        {t("projectDetail.discord.status.title")}
      </h3>
      <dl className="flex flex-col gap-1 text-xs">
        <StatusRow
          label={t("projectDetail.discord.status.server")}
          value={connection.guildName}
        />
        <StatusRow
          label={t("projectDetail.discord.status.channel")}
          value={`#${connection.channelName}`}
        />
        <StatusRow
          label={t("projectDetail.discord.status.lastSent")}
          value={
            delivery.lastSentAt
              ? new Date(delivery.lastSentAt).toLocaleString(i18n.language)
              : t("projectDetail.discord.status.never")
          }
        />
        <StatusRow
          label={t("projectDetail.discord.status.waiting")}
          value={String(delivery.pending)}
        />
        <StatusRow
          label={t("projectDetail.discord.status.failed")}
          value={String(delivery.failed)}
        />
      </dl>
      {hasProblem ? (
        <p
          className={cn(
            "rounded-xl bg-destructive-subtle px-3 py-2 text-xs font-medium text-destructive",
          )}
          role="alert"
        >
          {t(`projectDetail.discord.problem.${delivery.lastProblem}`)}
        </p>
      ) : null}
    </section>
  );
}
