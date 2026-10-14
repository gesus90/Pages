import { useTranslation } from "react-i18next";

import type { DiscordInstanceStatus } from "@/definition/Discord";

interface DiscordInstanceNoticeProps {
  readonly instance: DiscordInstanceStatus;
  /** Whether the visitor can start a connection and so needs the setup steps. */
  readonly canManage: boolean;
}

/**
 * Explains that the Discord application of the instance is not set up.
 *
 * @remarks
 * Credentials are never asked for here: they belong to the instance and are
 * set by an administrator on the server. Only the names of the missing
 * variables are shown, never a value.
 */
export function DiscordInstanceNotice({
  instance,
  canManage,
}: DiscordInstanceNoticeProps): React.ReactElement {
  const { t } = useTranslation();

  return (
    <section
      aria-labelledby="discord-instance-title"
      className="flex flex-col gap-3 rounded-2xl bg-muted/40 p-4"
      role="status"
    >
      <h3
        className="text-sm font-semibold text-foreground"
        id="discord-instance-title"
      >
        {t("projectDetail.discord.instance.title")}
      </h3>
      <p className="text-xs leading-relaxed text-muted-foreground">
        {canManage
          ? t("projectDetail.discord.instance.admin")
          : t("projectDetail.discord.instance.member")}
      </p>
      {canManage ? (
        <ul className="pages-selectable flex flex-col gap-1 font-mono text-xs text-foreground">
          {instance.missingSettings.map((name) => (
            <li key={name}>{name}</li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
