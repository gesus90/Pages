import { useId } from "react";
import { useTranslation } from "react-i18next";

import { AgentConfigurationFields } from "./agent-configuration-fields";
import { AgentProfileFields } from "./agent-profile-fields";
import { AgentProfileTargets } from "./agent-profile-targets";
import { AgentTemplateEditor } from "./agent-template-editor";

import type { AgentConfiguration } from "@/definition/AgentConfiguration";
import type { AgentProfileDirectory } from "@/definition/AgentProfile";
import type { AgentTaskAssignment } from "@/definition/AgentUsage";
import type { AgentWorkspaceChoice } from "@/definition/AgentWorkspace";
import type { AssignmentChoices } from "./use-agent-assignment";
import type { useAgentProfileDraft } from "./use-agent-profile-draft";

function AgentTaskAssignments({
  assignments,
}: {
  readonly assignments: readonly AgentTaskAssignment[];
}): React.ReactElement {
  const { t } = useTranslation();
  return (
    <div className="space-y-2 rounded-xl border border-border p-3">
      <p className="text-sm font-medium">
        {t("settings.agents.definition.planTasks")}
      </p>
      <p className="text-xs leading-relaxed text-muted-foreground">
        {t("settings.agents.definition.planTasksHint")}
      </p>
      {assignments.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {t("settings.agents.definition.planTasksEmpty")}
        </p>
      ) : (
        <ul className="pages-selectable space-y-1 text-sm">
          {assignments.map((assignment) => (
            <li
              key={`${assignment.planId}:${assignment.taskId}`}
              className="break-words"
            >
              <span className="font-medium">{assignment.key}</span>{" "}
              {assignment.title}
              <span className="text-muted-foreground">
                {" · "}
                {t("settings.agents.definition.planTaskSource", {
                  plan: assignment.planName,
                })}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function AgentUsageSharing(props: {
  readonly configuration: AgentConfiguration;
  readonly directory: AgentProfileDirectory;
  readonly disabled: boolean;
  readonly onChange: (configuration: AgentConfiguration) => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const { configuration } = props;
  return (
    <section className="space-y-3">
      <h3 className="text-base font-semibold">
        {t("settings.agents.definition.sharing")}
      </h3>
      <p className="text-sm text-muted-foreground">
        {t("settings.agents.definition.sharingHint")}
      </p>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          disabled={props.disabled}
          checked={configuration.sharing.isGlobal}
          onChange={(event) =>
            props.onChange({
              ...configuration,
              sharing: {
                ...configuration.sharing,
                isGlobal: event.target.checked,
              },
            })
          }
        />
        {t("settings.agents.definition.shareGlobally")}
      </label>
      <AgentProfileTargets
        directory={props.directory}
        targets={configuration.sharing.targets}
        disabled={props.disabled}
        isSharing
        onChange={(targets) =>
          props.onChange({
            ...configuration,
            sharing: { ...configuration.sharing, targets },
          })
        }
      />
    </section>
  );
}

/** Composes the access, template and usage sections without duplicating their configuration. */
export function AgentProfileFormBody(props: {
  readonly workspaceChoices?: readonly AgentWorkspaceChoice[];
  readonly draft: ReturnType<typeof useAgentProfileDraft>;
  readonly selection: AssignmentChoices;
  readonly isPending: boolean;
  readonly directory: AgentProfileDirectory;
  readonly projects: readonly { readonly id: string; readonly name: string }[];
  /** Absent for a new agent, which no execution plan can reference yet. */
  readonly taskAssignments?: readonly AgentTaskAssignment[];
}): React.ReactElement {
  const { t } = useTranslation();
  const assignedToId = useId();
  const { draft } = props;
  return (
    <>
      <AgentProfileFields
        name={draft.name}
        isActive={draft.isActive}
        purposes={draft.purposes}
        selection={props.selection}
        isPending={props.isPending}
        onName={draft.setName}
        onActive={draft.setActive}
        onPurposes={(purposes) => {
          draft.setPurposes(purposes);
          draft.setTargets(
            draft.targets.filter(
              (target) =>
                target.kind !== "system" ||
                purposes.some((purpose) => purpose === target.targetId),
            ),
          );
        }}
      />
      <AgentConfigurationFields
        configuration={draft.configuration}
        projects={props.projects}
        disabled={props.isPending}
        onChange={draft.setConfiguration}
        onTargets={draft.setTargets}
      />
      <section aria-labelledby={assignedToId} className="space-y-3">
        <h3 id={assignedToId} className="text-base font-semibold">
          {t("settings.agents.definition.assignedTo")}
        </h3>
        <p className="text-sm text-muted-foreground">
          {t("settings.agents.definition.assignmentHint")}
        </p>
        <AgentProfileTargets
          directory={props.directory}
          targets={draft.targets}
          scope={draft.configuration.scope}
          purposes={draft.purposes}
          disabled={props.isPending}
          onChange={draft.setTargets}
        />
        {props.taskAssignments ? (
          <AgentTaskAssignments assignments={props.taskAssignments} />
        ) : null}
      </section>
      <AgentTemplateEditor
        workspaceChoices={props.workspaceChoices?.filter(
          (workspace) =>
            draft.configuration.projectId === null ||
            workspace.projectId === draft.configuration.projectId,
        )}
        configuration={draft.configuration}
        provider={props.selection.provider}
        disabled={props.isPending}
        onChange={draft.setConfiguration}
      />
      <AgentUsageSharing
        configuration={draft.configuration}
        directory={props.directory}
        disabled={props.isPending}
        onChange={draft.setConfiguration}
      />
    </>
  );
}
