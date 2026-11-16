import { useTranslation } from "react-i18next";

import { Select } from "@/app/components/ui/select";
import {
  isAgentAccessMode,
  storedAgentAccessMode,
} from "@/definition/AgentAccessMode";
import { ACP_PERMISSION_MODES } from "@/definition/AgentConfiguration";

import type {
  AgentRunOptions,
  AcpPermissionMode,
} from "@/definition/AgentConfiguration";

/**
 * Chooses one of the two modes, "Lesend" or "YOLO", with the same meaning as for agent employees.
 * @remarks
 * An agent saved with the earlier write mode shows no mode, so nobody gets
 * YOLO without choosing it; the agent cannot run until a mode is chosen. An
 * earlier "full environment" shows as YOLO, which it is now.
 */
export function AcpModeField(props: {
  readonly options: AgentRunOptions;
  readonly disabled: boolean;
  readonly onChange: (mode: AcpPermissionMode) => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const mode = storedAgentAccessMode(props.options.access);
  function choose(value: string): void {
    if (isAgentAccessMode(value)) props.onChange(value);
  }
  return (
    <label className="space-y-1.5 text-sm font-medium">
      <span className="block">{t("settings.agents.run.mode")}</span>
      <Select
        size="default"
        className="w-full"
        value={mode ?? ""}
        ariaLabel={t("settings.agents.run.mode")}
        disabled={props.disabled}
        onValueChange={choose}
        options={[
          // Only shown while no mode is stored; it cannot be chosen.
          ...(mode === null
            ? [
                {
                  value: "",
                  label: t("settings.agents.run.chooseMode"),
                  disabled: true,
                },
              ]
            : []),
          ...ACP_PERMISSION_MODES.map((entry) => ({
            value: entry,
            label: t(`settings.agents.run.modes.${entry}.label`),
            description: t(`settings.agents.run.modes.${entry}.description`),
          })),
        ]}
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
