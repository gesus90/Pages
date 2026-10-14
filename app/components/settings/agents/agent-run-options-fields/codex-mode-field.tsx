import { useTranslation } from "react-i18next";

import { Select } from "@/app/components/ui/select";
import {
  CODEX_PERMISSION_MODES,
  isCodexPermissionMode,
} from "@/definition/AgentConfiguration";

import type {
  AgentRunOptions,
  CodexPermissionMode,
} from "@/definition/AgentConfiguration";

/**
 * Chooses one of the two modes of a Codex CLI agent: "Nur Lesen" or YOLO.
 *
 * @remarks
 * An agent saved with the earlier write mode shows no mode, so nobody gets
 * YOLO without choosing it; the agent cannot run until a mode is chosen.
 */
export function CodexModeField(props: {
  readonly options: AgentRunOptions;
  readonly disabled: boolean;
  readonly onChange: (mode: CodexPermissionMode) => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const mode = isCodexPermissionMode(props.options.access)
    ? props.options.access
    : null;
  function choose(value: string): void {
    if (isCodexPermissionMode(value)) props.onChange(value);
  }
  return (
    <label className="space-y-1.5 text-sm font-medium">
      <span className="block">{t("settings.agents.run.mode")}</span>
      <Select
        size="default"
        className="w-full"
        value={mode ?? ""}
        placeholder={t("settings.agents.run.chooseMode")}
        disabled={props.disabled}
        onValueChange={choose}
        options={CODEX_PERMISSION_MODES.map((entry) => ({
          value: entry,
          label: t(`settings.agents.run.modes.${entry}.label`),
          description: t(`settings.agents.run.modes.${entry}.description`),
        }))}
      />
      {mode === null ? (
        <span className="block text-xs font-normal text-warning">
          {t("settings.agents.run.modeRequired")}
        </span>
      ) : (
        <span className="block text-xs font-normal text-muted-foreground">
          {t(`settings.agents.run.modes.${mode}.description`)}
        </span>
      )}
    </label>
  );
}
