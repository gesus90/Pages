import { agentPlanNameKey } from "@/definition/AgentPlanName";

import type { TFunction } from "i18next";
import type { AgentPlanPage } from "@/definition/AgentPlan";
import type { AgentPlanExecutionTarget } from "@/definition/AgentPlanExecution";
import type { AgentPlanRemoteChoice } from "@/definition/AgentPlanTarget";
import type { AgentWorkspaceChoice } from "@/definition/AgentWorkspace";

/** Name, project and location of a plan, as the plan dialogs edit them. */
export interface PlanContextValues {
  readonly name: string;
  readonly projectId: string;
  /** `local:<workspace>` for the Pages host, `remote:<workspace>` for a runner. */
  readonly location: string;
}

/** The plan fields a location stands for. */
export interface PlanLocation {
  /** The actual local or remote registration selected for the plan. */
  readonly workspaceId: string;
  readonly executionTarget: AgentPlanExecutionTarget | undefined;
}

/** One entry of the shared selection of local and remote workspaces. */
export interface PlanLocationOption {
  readonly value: string;
  readonly label: string;
  /** The line of the option in the list: directory, host and why it is unavailable. */
  readonly description: string;
  /** The line under the closed selection: where the chosen location runs. */
  readonly hint: string;
  readonly disabled: boolean;
  readonly kind: "local" | "remote";
}

const REMOTE_OWN_REASONS = new Set([
  "project_unavailable",
  "github_missing",
  "connection_blocked",
  "unchecked",
]);

/** The projects of all visible local and remote registrations. */
export function planProjects(
  page: AgentPlanPage,
): readonly { readonly value: string; readonly label: string }[] {
  return [
    ...new Map(
      page.workspaces.map((entry) => [
        entry.projectId,
        { value: entry.projectId, label: entry.projectName },
      ]),
    ).values(),
  ];
}

/** The selection value of a plan's location. */
export function planLocationValue(plan: {
  readonly workspaceId: string;
  readonly executionTarget?: AgentPlanExecutionTarget;
}): string {
  return plan.executionTarget?.kind === "remote"
    ? `remote:${plan.executionTarget.workspaceId}`
    : `local:${plan.workspaceId}`;
}

function remoteReason(
  choice: AgentPlanRemoteChoice,
  translate: TFunction,
): string {
  if (!choice.reason) return "";
  if (choice.reason === "console_denied")
    return translate("plans.manage.remoteDenied");
  return REMOTE_OWN_REASONS.has(choice.reason)
    ? translate(`remote.workspace.reason.${choice.reason}`)
    : translate(`remote.failure.${choice.reason}`, {
        defaultValue: translate("plans.execution.unavailable"),
      });
}

function localOption(
  workspace: AgentWorkspaceChoice,
  translate: TFunction,
): PlanLocationOption {
  return {
    value: `local:${workspace.id}`,
    label: translate("plans.manage.localOption", { name: workspace.name }),
    description: [translate("plans.execution.local"), workspace.path]
      .filter(Boolean)
      .join(" · "),
    hint: [translate("plans.manage.location.local"), workspace.path]
      .filter(Boolean)
      .join(" · "),
    disabled: false,
    kind: "local",
  };
}

function remoteOption(
  choice: AgentPlanRemoteChoice,
  translate: TFunction,
): PlanLocationOption {
  return {
    value: `remote:${choice.workspaceId}`,
    label: translate("plans.manage.remoteOption", {
      name: choice.workspaceName,
      host: choice.connectionName,
    }),
    description: [
      choice.connectionName,
      choice.path,
      remoteReason(choice, translate),
    ]
      .filter(Boolean)
      .join(" · "),
    hint: [
      translate("plans.manage.location.remote", {
        host: choice.connectionName,
      }),
      choice.path,
    ].join(" · "),
    disabled: !choice.isUsable,
    kind: "remote",
  };
}

/**
 * The local and remote workspaces of a project in one selection.
 *
 * @remarks
 * Local workspaces run on the Pages host; remote ones on the runner of their
 * SSH connection, which the option names. A remote workspace the person may
 * see but not use stays visible, disabled, with the reason.
 */
export function planLocationOptions(
  page: AgentPlanPage,
  projectId: string,
  translate: TFunction,
): readonly PlanLocationOption[] {
  return [
    ...page.workspaces
      .filter(
        (entry) => entry.projectId === projectId && entry.kind !== "remote",
      )
      .map((entry) => localOption(entry, translate)),
    ...(page.remoteWorkspaces ?? [])
      .filter((entry) => entry.projectId === projectId)
      .map((entry) => remoteOption(entry, translate)),
  ];
}

/**
 * The plan fields of a chosen location.
 *
 * @param page - The plan page with the workspaces the person may use.
 * @param values - The chosen project and location.
 */
export function planLocationFields(
  page: AgentPlanPage,
  values: Pick<PlanContextValues, "projectId" | "location">,
): PlanLocation | null {
  const [kind, id] = values.location.split(":", 2);
  const local = page.workspaces.find(
    (entry) =>
      entry.id === id &&
      entry.projectId === values.projectId &&
      entry.kind !== "remote",
  );
  if (kind === "local")
    return local ? { workspaceId: id, executionTarget: undefined } : null;
  const remote = page.remoteWorkspaces?.find(
    (entry) =>
      entry.workspaceId === id &&
      entry.projectId === values.projectId &&
      entry.isUsable,
  );
  if (kind !== "remote" || !remote) return null;
  return {
    workspaceId: id,
    executionTarget: { kind: "remote", workspaceId: id },
  };
}

/** The first location of a project, used when the person changes the project. */
export function firstPlanLocation(
  options: readonly PlanLocationOption[],
): string {
  return options.find((option) => !option.disabled)?.value ?? "";
}

/**
 * Whether a plan the person can see already has the name in the same team area.
 *
 * @remarks
 * An early warning with the key the server uses; the server alone decides
 * when the plan is stored.
 */
export function isPlanNameUsed(
  page: AgentPlanPage,
  plan: {
    readonly name: string;
    readonly projectId: string;
    readonly departmentId: string | null;
    /** The plan being renamed, which may keep its own name. */
    readonly exceptId?: string;
  },
): boolean {
  const key = agentPlanNameKey(plan.name);
  if (key === "" || plan.departmentId === null) return false;
  return page.plans.some(
    (entry) =>
      entry.id !== plan.exceptId &&
      entry.departmentId === plan.departmentId &&
      entry.projectId === plan.projectId &&
      agentPlanNameKey(entry.name) === key,
  );
}

/** The translated refusal of a plan request. */
export function planRequestError(
  code: string | null,
  translate: TFunction,
): string | null {
  return code
    ? translate(`settings.agents.error.${code}`, {
        defaultValue: translate("plans.panel.error"),
      })
    : null;
}

/**
 * The fields a dialog sends for a context: name, local workspace and plan target.
 *
 * @returns `null` while the name is empty or the location is not usable.
 */
export function planContextRequest(
  page: AgentPlanPage,
  values: PlanContextValues,
): Readonly<Record<string, string>> | null {
  const fields = planLocationFields(page, values);
  if (!fields || values.name.trim() === "") return null;
  return {
    name: values.name.trim(),
    workspaceId: fields.workspaceId,
    target: fields.executionTarget
      ? JSON.stringify(fields.executionTarget)
      : "",
  };
}
