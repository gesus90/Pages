import { useTranslation } from "react-i18next";

import { Checkbox } from "@/app/components/ui/checkbox";
import { Input } from "@/app/components/ui/input";
import { Select } from "@/app/components/ui/select";
import {
  isAgentAccessMode,
  storedAgentAccessMode,
} from "@/definition/AgentAccessMode";
import {
  ACP_PERMISSION_MODES,
  AGENT_RUN_TIMEOUT_MINUTES,
  DEFAULT_AGENT_RUN_OPTIONS,
  acpRunOptions,
  defaultAgentRunOptions,
  isAcpProvider,
  isAgentWriteAccess,
} from "@/definition/AgentConfiguration";

import type {
  AcpPermissionMode,
  AgentConfiguration,
  AgentRunOptions,
} from "@/definition/AgentConfiguration";
import type { AgentProviderId } from "@/definition/AgentConnection";

// An agent saved with the earlier write mode shows no mode, so nobody gets
// YOLO without choosing it; the agent cannot run until a mode is chosen. An
// earlier "full environment" shows as YOLO, which it is now.
function AcpModeField(props: {
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

function CodexCostLimitField(props: {
  readonly limit: number | undefined;
  readonly onChange: (limit: number | undefined) => void;
}): React.ReactElement {
  const { t } = useTranslation();
  return (
    <label className="block space-y-1.5 text-sm font-medium">
      <span className="block">{t("codexUsage.monthlyLimit")}</span>
      <Input
        type="number"
        min={0}
        step="any"
        value={props.limit ?? ""}
        onChange={(event) =>
          props.onChange(
            event.target.value === "" ? undefined : event.target.valueAsNumber,
          )
        }
      />
      <span className="block text-xs font-normal text-muted-foreground">
        {t("codexUsage.monthlyLimitHint")}
      </span>
    </label>
  );
}

function RunTimeoutField(props: {
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

function RunnerAccessField(props: {
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

function RunnerToolFields(props: {
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

/**
 * Edits how CLI runners may work in a plan workspace; no free command or argument is offered.
 * @remarks
 * A Codex CLI, Claude Code or OpenCode agent offers only its two modes, "Lesend" and
 * YOLO, and no separate switches that could mix or narrow them. Every other
 * runner keeps its access, shell and web switches. The timeout applies to all.
 */
export function AgentRunOptionsFields(props: {
  readonly configuration: AgentConfiguration;
  /** The provider of the chosen model; `null` while none is chosen. */
  readonly provider: AgentProviderId | null;
  readonly disabled: boolean;
  readonly onChange: (configuration: AgentConfiguration) => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const isAcp = props.provider !== null && isAcpProvider(props.provider);
  const options =
    props.configuration.run ??
    (props.provider === null
      ? DEFAULT_AGENT_RUN_OPTIONS
      : defaultAgentRunOptions(props.provider));
  function change(next: Partial<AgentRunOptions>): void {
    props.onChange({ ...props.configuration, run: { ...options, ...next } });
  }
  function chooseMode(mode: AcpPermissionMode): void {
    props.onChange({
      ...props.configuration,
      run: {
        ...acpRunOptions(mode, options.timeoutMinutes),
        ...(options.monthlyCostLimitUsd === undefined
          ? {}
          : { monthlyCostLimitUsd: options.monthlyCostLimitUsd }),
        ...(options.browser === undefined
          ? {}
          : { browser: mode === "yolo" && options.browser }),
      },
    });
  }
  return (
    <fieldset className="space-y-3" disabled={props.disabled}>
      <legend className="text-base font-semibold">
        {t("settings.agents.run.title")}
      </legend>
      <p className="text-sm text-muted-foreground">
        {t(isAcp ? "settings.agents.run.acpHint" : "settings.agents.run.hint")}
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        {isAcp ? (
          <AcpModeField
            options={options}
            disabled={props.disabled}
            onChange={chooseMode}
          />
        ) : (
          <RunnerAccessField
            options={options}
            disabled={props.disabled}
            onChange={change}
          />
        )}
        <RunTimeoutField
          timeoutMinutes={options.timeoutMinutes}
          onChange={(timeoutMinutes) => change({ timeoutMinutes })}
        />
      </div>
      <p className="text-xs text-muted-foreground">
        {t("settings.agents.run.timeoutHint")}
      </p>
      {isAcp && isAgentWriteAccess(options.access) ? (
        <label className="flex items-center gap-2 text-sm">
          <Checkbox
            checked={options.browser === true}
            onChange={(event) => change({ browser: event.target.checked })}
          />
          {t("agentTools.browserPermission")}
        </label>
      ) : null}
      {props.provider === "codex_cli" ? (
        <CodexCostLimitField
          limit={options.monthlyCostLimitUsd}
          onChange={(monthlyCostLimitUsd) => change({ monthlyCostLimitUsd })}
        />
      ) : null}
      {isAcp ? null : <RunnerToolFields options={options} onChange={change} />}
    </fieldset>
  );
}
