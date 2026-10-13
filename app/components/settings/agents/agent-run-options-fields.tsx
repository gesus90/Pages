import { useTranslation } from "react-i18next";

import { Checkbox } from "@/app/components/ui/checkbox";
import { Input } from "@/app/components/ui/input";
import { Select } from "@/app/components/ui/select";
import {
  AGENT_RUN_TIMEOUT_MINUTES,
  DEFAULT_AGENT_RUN_OPTIONS,
} from "@/definition/AgentConfiguration";

import type {
  AgentConfiguration,
  AgentRunOptions,
} from "@/definition/AgentConfiguration";

/** Edits how CLI runners may work in a plan workspace; no free command or argument is offered. */
export function AgentRunOptionsFields(props: {
  readonly configuration: AgentConfiguration;
  readonly disabled: boolean;
  readonly onChange: (configuration: AgentConfiguration) => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const options = props.configuration.run ?? DEFAULT_AGENT_RUN_OPTIONS;
  function change(next: Partial<AgentRunOptions>): void {
    props.onChange({ ...props.configuration, run: { ...options, ...next } });
  }
  function chooseAccess(access: string): void {
    if (access === "workspace_write" || access === "read_only")
      change({ access });
  }
  function chooseTimeout(text: string): void {
    const minutes = Number(text);
    if (Number.isSafeInteger(minutes)) change({ timeoutMinutes: minutes });
  }
  return (
    <fieldset className="space-y-3" disabled={props.disabled}>
      <legend className="text-base font-semibold">
        {t("settings.agents.run.title")}
      </legend>
      <p className="text-sm text-muted-foreground">
        {t("settings.agents.run.hint")}
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="space-y-1.5 text-sm font-medium">
          <span className="block">{t("settings.agents.run.access")}</span>
          <Select
            size="default"
            className="w-full"
            value={options.access}
            disabled={props.disabled}
            onValueChange={chooseAccess}
            options={(["workspace_write", "read_only"] as const).map(
              (access) => ({
                value: access,
                label: t(`plans.session.access.${access}`),
              }),
            )}
          />
        </label>
        <label className="space-y-1.5 text-sm font-medium">
          <span className="block">{t("settings.agents.run.timeout")}</span>
          <Input
            type="number"
            min={AGENT_RUN_TIMEOUT_MINUTES.minimum}
            max={AGENT_RUN_TIMEOUT_MINUTES.maximum}
            step={1}
            value={options.timeoutMinutes}
            onChange={(event) => chooseTimeout(event.target.value)}
          />
        </label>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <Checkbox
          checked={options.shell}
          onChange={(event) => change({ shell: event.target.checked })}
        />
        {t("settings.agents.run.shell")}
      </label>
      <label className="flex items-center gap-2 text-sm">
        <Checkbox
          checked={options.web}
          onChange={(event) => change({ web: event.target.checked })}
        />
        {t("settings.agents.run.web")}
      </label>
    </fieldset>
  );
}
