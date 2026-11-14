import { ShieldAlert } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { cn } from "@/app/lib/cn";
import {
  AGENT_EMPLOYEE_ACCESS_MODES,
  hasHostTools,
} from "@/definition/AgentEmployee";

import { AgentTemplateConfirm } from "./agent-template-confirm";

import type {
  AgentAccessEnvironment,
  AgentEmployeeAccess,
} from "@/definition/AgentEmployee";

interface AgentAccessSectionProps {
  readonly value: AgentEmployeeAccess;
  readonly savedValue: AgentEmployeeAccess | null;
  readonly onChange: (access: AgentEmployeeAccess) => void;
  /** Whether the person may change the level: an administrator in active admin mode. */
  readonly canChange: boolean;
  readonly canAssignYolo?: boolean;
  /** `null` while a new agent is created, which starts on "Nur Pages". */
  readonly environment: AgentAccessEnvironment | null;
}

/** One level with its explanation, as a radio choice. */
function LevelOption({
  level,
  isChecked,
  isDisabled,
  onSelect,
}: {
  readonly level: AgentEmployeeAccess;
  readonly isChecked: boolean;
  readonly isDisabled: boolean;
  readonly onSelect: (level: AgentEmployeeAccess) => void;
}): React.ReactElement {
  const { t } = useTranslation();
  return (
    <label
      className={cn(
        "flex items-start gap-3 rounded-xl border px-4 py-3 text-sm",
        isChecked ? "border-primary bg-primary-subtle" : "border-border",
        isDisabled ? "cursor-not-allowed opacity-60" : "cursor-pointer",
        level === "yolo" && isChecked ? "border-destructive" : "",
      )}
    >
      <input
        checked={isChecked}
        className="mt-1"
        disabled={isDisabled}
        name="agent-access-level"
        onChange={() => onSelect(level)}
        type="radio"
        value={level}
      />
      <span className="flex flex-col gap-0.5">
        <span
          className={cn(
            "font-semibold",
            level === "yolo" ? "text-destructive" : "text-foreground",
          )}
        >
          {t(`agentEmployees.access.${level}`)}
        </span>
        <span className="text-muted-foreground">
          {t(`agentEmployees.access.hint.${level}`)}
        </span>
      </span>
    </label>
  );
}

/** The MCP servers Pages detected for the agent's CLI, for information only. */
function DetectedMcpServers({
  environment,
}: {
  readonly environment: AgentAccessEnvironment;
}): React.ReactElement {
  const { t } = useTranslation();
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-sm font-semibold text-foreground">
        {t("agentEmployees.accessTab.mcpTitle")}
      </h3>
      <p className="text-xs text-muted-foreground">
        {t("agentEmployees.accessTab.mcpHint")}
      </p>
      {environment.mcpServers.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {t("agentEmployees.accessTab.mcpEmpty")}
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-border/60 rounded-xl border border-border">
          {environment.mcpServers.map((server) => (
            <li
              className="flex items-center justify-between gap-3 px-3 py-2 text-sm"
              key={`${server.source}:${server.name}`}
            >
              <span className="font-mono">{server.name}</span>
              <span className="text-xs text-muted-foreground">
                {server.transport} · {server.source}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

interface AccessNoticesProps {
  readonly canChange: boolean;
  readonly environment: AgentAccessEnvironment | null;
}

/** The notices above the level choice: a new agent, a missing admin mode or a missing isolation. */
function AccessNotices({
  canChange,
  environment,
}: AccessNoticesProps): React.ReactElement {
  const { t } = useTranslation();
  return (
    <>
      {environment === null ? (
        <p className="text-sm text-muted-foreground">
          {t("agentEmployees.accessTab.createHint")}
        </p>
      ) : null}
      {environment !== null && !canChange ? (
        <p className="text-sm text-muted-foreground">
          {t("agentEmployees.accessTab.adminOnly")}
        </p>
      ) : null}
      {environment !== null && !environment.isIsolationAvailable ? (
        <p
          className="flex items-start gap-2 rounded-xl bg-warning-subtle px-3 py-2 text-sm text-warning"
          role="status"
        >
          <ShieldAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          {t("agentEmployees.accessTab.isolationMissing")}
        </p>
      ) : null}
    </>
  );
}

interface AccessLevelFieldsetProps {
  readonly value: AgentEmployeeAccess;
  readonly savedValue: AgentEmployeeAccess | null;
  readonly canAssignYolo: boolean;
  readonly isLocked: boolean;
  readonly isIsolationAvailable: boolean;
  readonly onSelect: (level: AgentEmployeeAccess) => void;
}

/** The radio group of the access levels; a level the person may not take is disabled. */
function AccessLevelFieldset({
  value,
  savedValue,
  canAssignYolo,
  isLocked,
  isIsolationAvailable,
  onSelect,
}: AccessLevelFieldsetProps): React.ReactElement {
  const { t } = useTranslation();
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-2 text-sm font-semibold text-foreground">
        {t("agentEmployees.accessTab.legend")}
      </legend>
      {AGENT_EMPLOYEE_ACCESS_MODES.filter(
        (level) => canAssignYolo || level !== "yolo" || savedValue === "yolo",
      ).map((level) => (
        <LevelOption
          isChecked={value === level}
          isDisabled={
            isLocked ||
            (level === "workspace" &&
              !isIsolationAvailable &&
              savedValue !== "workspace")
          }
          key={level}
          level={level}
          onSelect={onSelect}
        />
      ))}
    </fieldset>
  );
}

/**
 * The tab "Zugriff" (PAGE-303): the three access levels of the agent's
 * chats, the isolation of the host and the MCP servers Pages detected.
 *
 * @remarks
 * Only an administrator in active admin mode changes the level; the server
 * checks that again on saving. YOLO is taken only after a confirmation, and
 * "Arbeitsplatz" cannot be chosen on a host without the isolation.
 */
export function AgentAccessSection({
  value,
  savedValue,
  onChange,
  canChange,
  canAssignYolo = true,
  environment,
}: AgentAccessSectionProps): React.ReactElement {
  const { t } = useTranslation();
  const [isConfirming, setConfirming] = useState(false);
  const isIsolationAvailable = environment?.isIsolationAvailable ?? false;
  const isLocked = !canChange || environment === null;

  function select(level: AgentEmployeeAccess): void {
    if (level === value) return;
    if (level === "yolo") {
      if (!canAssignYolo) return;
      setConfirming(true);
      return;
    }
    onChange(level);
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        {t("agentEmployees.accessTab.intro")}
      </p>
      <AccessNotices canChange={canChange} environment={environment} />
      <p className="text-sm text-foreground" role="status">
        {t(
          hasHostTools(savedValue ?? value)
            ? "agentEmployees.accessTab.browserAllowed"
            : "agentEmployees.accessTab.browserDenied",
        )}
      </p>
      <AccessLevelFieldset
        value={value}
        savedValue={savedValue}
        canAssignYolo={canAssignYolo}
        isLocked={isLocked}
        isIsolationAvailable={isIsolationAvailable}
        onSelect={select}
      />
      {savedValue !== null && savedValue !== value ? (
        <p className="text-sm text-muted-foreground" role="status">
          {t("agentEmployees.accessTab.pending")}
        </p>
      ) : null}
      {environment ? <DetectedMcpServers environment={environment} /> : null}
      {isConfirming ? (
        <AgentTemplateConfirm
          title={t("agentEmployees.accessTab.confirmTitle")}
          description={t("agentEmployees.accessTab.confirmText")}
          confirmLabel={t("agentEmployees.accessTab.confirm")}
          isDestructive
          onConfirm={() => {
            setConfirming(false);
            onChange("yolo");
          }}
          onCancel={() => setConfirming(false)}
        />
      ) : null}
    </div>
  );
}
