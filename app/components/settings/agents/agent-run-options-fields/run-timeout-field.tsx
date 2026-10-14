import { useTranslation } from "react-i18next";

import { Input } from "@/app/components/ui/input";
import { AGENT_RUN_TIMEOUT_MINUTES } from "@/definition/AgentConfiguration";

/** Edits the hard duration limit of a run, which every runner applies. */
export function RunTimeoutField(props: {
  readonly timeoutMinutes: number;
  readonly onChange: (timeoutMinutes: number) => void;
}): React.ReactElement {
  const { t } = useTranslation();
  function chooseTimeout(text: string): void {
    if (!text.trim()) return;
    const minutes = Number(text);
    if (Number.isSafeInteger(minutes)) props.onChange(minutes);
  }
  return (
    <label className="space-y-1.5 text-sm font-medium">
      <span className="block">{t("settings.agents.run.timeout")}</span>
      <Input
        type="number"
        aria-label={t("settings.agents.run.timeout")}
        min={AGENT_RUN_TIMEOUT_MINUTES.minimum}
        max={AGENT_RUN_TIMEOUT_MINUTES.maximum}
        step={1}
        value={props.timeoutMinutes}
        onChange={(event) => chooseTimeout(event.target.value)}
      />
      <span className="block text-xs font-normal text-muted-foreground">
        {t(
          props.timeoutMinutes === 0
            ? "settings.agents.run.unlimited"
            : "settings.agents.run.hardTimeout",
          { minutes: props.timeoutMinutes },
        )}
      </span>
    </label>
  );
}
