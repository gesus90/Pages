import { useId } from "react";
import { useTranslation } from "react-i18next";

import { AgentConfigurationFields } from "./agent-configuration-fields";
import { AgentProfileFields } from "./agent-profile-fields";
import { AgentProfileTargets } from "./agent-profile-targets";
import { AgentTaskAssignments } from "./agent-task-assignments";
import { AgentTemplateEditor } from "./agent-template-editor";
import { AgentUsageSharing } from "./agent-usage-sharing";

import type { AgentWorkspaceChoice } from "@/definition/AgentWorkspace";
import type { AgentProfileDirectory } from "@/definition/AgentProfile";
import type { AgentTaskAssignment } from "@/definition/AgentUsage";
import type { AssignmentChoices } from "./use-agent-assignment";
import type { useAgentProfileDraft } from "./use-agent-profile-draft";

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
