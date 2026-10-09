import { useTranslation } from "react-i18next";

import type { AgentActionResult } from "@/app/lib/settings-actions/settings-agents-response.server";

/** Shows only stable translated action results; native errors never enter the UI. */
export function AgentAssignmentResult({
  result,
}: {
  readonly result: AgentActionResult | undefined;
}): React.ReactElement | null {
  const { t } = useTranslation();
  if (!result) return null;
  if (result.ok) return <p role="status">{t("assistant.settings.saved")}</p>;
  return (
    <p role="alert" className="text-sm text-destructive">
      {t(`assistant.error.${result.error}`, {
        defaultValue: t(`settings.agents.error.${result.error}`),
      })}
    </p>
  );
}
