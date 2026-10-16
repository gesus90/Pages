import { useTranslation } from "react-i18next";

import {
  DEFAULT_AGENT_RUN_OPTIONS,
  acpRunOptions,
  defaultAgentRunOptions,
  isAcpProvider,
} from "@/definition/AgentConfiguration";

import { AcpModeField } from "./agent-run-options-fields/acp-mode-field";
import { RunTimeoutField } from "./agent-run-options-fields/run-timeout-field";
import {
  RunnerAccessField,
  RunnerToolFields,
} from "./agent-run-options-fields/runner-access-fields";

import type {
  AcpPermissionMode,
  AgentConfiguration,
  AgentRunOptions,
} from "@/definition/AgentConfiguration";
import type { AgentProviderId } from "@/definition/AgentConnection";

/**
 * Edits how CLI runners may work in a plan workspace; no free command or argument is offered.
 *
 * @remarks
 * A Codex CLI, Claude Code or OpenCode agent offers only its two modes, "Nur Lesen" and
 * YOLO, and no separate switches that could mix them. Every other runner keeps
 * its access, shell and web switches. The timeout applies to all.
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
      run: acpRunOptions(mode, options.timeoutMinutes),
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
      {isAcp ? null : <RunnerToolFields options={options} onChange={change} />}
    </fieldset>
  );
}
