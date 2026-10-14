import { useTranslation } from "react-i18next";

import { Select } from "@/app/components/ui/select";
import {
  ACP_PERMISSION_MODES,
  isAcpPermissionMode,
} from "@/definition/AgentConfiguration";

import type {
  AgentRunOptions,
  AcpPermissionMode,
} from "@/definition/AgentConfiguration";

/**
 * Chooses one of the two modes of an ACP agent: "Nur Lesen" or YOLO.
 *
 * @remarks
 * An agent saved with the earlier write mode shows no mode, so nobody gets
 * YOLO without choosing it; the agent cannot run until a mode is chosen.
 */
export function AcpModeField(props: {
  readonly options: AgentRunOptions;
  readonly disabled: boolean;
  readonly onChange: (mode: AcpPermissionMode) => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const mode = isAcpPermissionMode(props.options.access)
    ? props.options.access
    : null;
  function choose(value: string): void {
    if (isAcpPermissionMode(value)) props.onChange(value);
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
