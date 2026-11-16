import { ShieldAlert } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { cn } from "@/app/lib/cn";
import { isLegacyAgentAccess } from "@/definition/AgentAccessMode";
import { AGENT_EMPLOYEE_ACCESS_MODES } from "@/definition/AgentEmployee";
import { agentToolPolicy } from "@/definition/AgentToolGroups";

import { AgentTemplateConfirm } from "./agent-template-confirm";

import type {
  AgentAccessEnvironment,
  AgentEmployeeAccess,
} from "@/definition/AgentEmployee";
import type { AgentToolGroupMode } from "@/definition/AgentToolGroups";

/** What the saved level allows in the browser: nothing, reading or everything. */
const BROWSER_GRANTS: Readonly<Record<AgentToolGroupMode, string>> = {
  off: "agentEmployees.accessTab.browserDenied",
  read: "agentEmployees.accessTab.browserReadOnly",
  full: "agentEmployees.accessTab.browserAllowed",
};

interface AgentAccessSectionProps {
  readonly value: AgentEmployeeAccess;
  readonly savedValue: AgentEmployeeAccess | null;
  readonly onChange: (access: AgentEmployeeAccess) => void;
  /** Whether the person may change the level: an administrator in active admin mode. */
  readonly canChange: boolean;
  readonly canAssignYolo?: boolean;
  /** `null` while a new agent is created, which starts on "Lesend". */
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
  readonly value: AgentEmployeeAccess;
}

/** A warning line of the access tab. */
function AccessWarning({
  text,
}: {
  readonly text: string;
}): React.ReactElement {
  return (
    <p
      className="flex items-start gap-2 rounded-xl bg-warning-subtle px-3 py-2 text-sm text-warning"
      role="status"
    >
      <ShieldAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      {text}
    </p>
  );
}

/** The notices above the level choice: a new agent, a missing admin mode, the host's facts and an earlier level. */
function AccessNotices({
  canChange,
  environment,
  value,
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
      {isLegacyAgentAccess(value) ? (
        <AccessWarning text={t("agentEmployees.accessTab.legacyLevel")} />
      ) : null}
      {environment !== null && !environment.isIsolationAvailable ? (
        <AccessWarning text={t("agentEmployees.accessTab.isolationMissing")} />
      ) : null}
      {environment !== null && !environment.isNativeHostAvailable ? (
        <AccessWarning text={t("agentEmployees.accessTab.nativeHostMissing")} />
      ) : null}
    </>
  );
}

interface AccessLevelFieldsetProps {
  readonly value: AgentEmployeeAccess;
  readonly savedValue: AgentEmployeeAccess | null;
  readonly canAssignYolo: boolean;
  readonly isLocked: boolean;
  /** Whether YOLO can start natively on this host. */
  readonly isNativeHostAvailable: boolean;
  readonly onSelect: (level: AgentEmployeeAccess) => void;
}

/** The radio group of the two modes; a mode the person may not take is disabled. */
function AccessLevelFieldset({
  value,
  savedValue,
  canAssignYolo,
  isLocked,
  isNativeHostAvailable,
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
            (level === "yolo" &&
              !isNativeHostAvailable &&
              savedValue !== "yolo")
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
 * The tab "Zugriff": the two modes of the agent, "Lesend" and "YOLO", with
 * the same meaning in chats, in its own jobs and in plans, the facts of the
 * host and the MCP servers Pages detected.
 *
 * @remarks
 * Only an administrator in active admin mode changes the level; the server
 * checks that again on saving. YOLO is taken only after a confirmation and
 * only where the host confirms the process ownership of native sessions. An
 * agent with the earlier "Arbeitsplatz" keeps it until one of the two modes
 * is chosen and runs no session until then.
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
  const isNativeHostAvailable = environment?.isNativeHostAvailable ?? false;
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
      <AccessNotices
        canChange={canChange}
        environment={environment}
        value={value}
      />
      <p className="text-sm text-foreground" role="status">
        {t(BROWSER_GRANTS[agentToolPolicy(savedValue ?? value).browser])}
      </p>
      <AccessLevelFieldset
        value={value}
        savedValue={savedValue}
        canAssignYolo={canAssignYolo}
        isLocked={isLocked}
        isNativeHostAvailable={isNativeHostAvailable}
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
