import { useTranslation } from "react-i18next";

import type { PlanRunCommandReceipt } from "@/definition/PagesRuns";

/** Shows admission separately from execution while the background scheduler applies a command. */
export function PlanCommandNote({
  command,
}: {
  readonly command: PlanRunCommandReceipt | undefined;
}): React.ReactElement | null {
  const { t, i18n } = useTranslation();
  if (!command || command.status === "applied") return null;
  const errorKey = `settings.agents.error.${command.error}`;
  return (
    <p
      role="status"
      className="border-t border-border bg-muted/50 px-3 py-2 text-xs text-muted-foreground"
    >
      {t(`plans.command.${command.status}`, {
        action: t(`plans.command.action.${command.action}`),
      })}
      {command.error && i18n.exists(errorKey) ? ` ${t(errorKey)}` : null}
    </p>
  );
}
