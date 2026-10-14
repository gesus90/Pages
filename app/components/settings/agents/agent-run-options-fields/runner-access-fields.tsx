import { useTranslation } from "react-i18next";

import { Checkbox } from "@/app/components/ui/checkbox";
import { Select } from "@/app/components/ui/select";

import type { AgentRunOptions } from "@/definition/AgentConfiguration";

/** The workspace access of runners other than Codex: write or read only. */
export function RunnerAccessField(props: {
  readonly options: AgentRunOptions;
  readonly disabled: boolean;
  readonly onChange: (next: Partial<AgentRunOptions>) => void;
}): React.ReactElement {
  const { t } = useTranslation();
  function chooseAccess(access: string): void {
    if (access === "workspace_write" || access === "read_only")
      props.onChange({ access });
  }
  return (
    <label className="space-y-1.5 text-sm font-medium">
      <span className="block">{t("settings.agents.run.access")}</span>
      <Select
        size="default"
        className="w-full"
        value={props.options.access}
        disabled={props.disabled}
        onValueChange={chooseAccess}
        options={(["workspace_write", "read_only"] as const).map((access) => ({
          value: access,
          label: t(`plans.session.access.${access}`),
        }))}
      />
    </label>
  );
}

/** The separate shell and web switches of runners other than Codex. */
export function RunnerToolFields(props: {
  readonly options: AgentRunOptions;
  readonly onChange: (next: Partial<AgentRunOptions>) => void;
}): React.ReactElement {
  const { t } = useTranslation();
  return (
    <>
      <label className="flex items-center gap-2 text-sm">
        <Checkbox
          checked={props.options.shell}
          onChange={(event) => props.onChange({ shell: event.target.checked })}
        />
        {t("settings.agents.run.shell")}
      </label>
      <label className="flex items-center gap-2 text-sm">
        <Checkbox
          checked={props.options.web}
          onChange={(event) => props.onChange({ web: event.target.checked })}
        />
        {t("settings.agents.run.web")}
      </label>
    </>
  );
}
