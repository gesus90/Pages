import { useTranslation } from "react-i18next";

import { Input } from "@/app/components/ui/input";

import { WorkspacePathStep } from "./workspace-path-step";
import { WorkspaceProjectStep } from "./workspace-project-step";

import type {
  AgentWorkspaceInput,
  AgentWorkspaceProject,
} from "@/definition/AgentWorkspace";

/** Name first, then the two choices that make a registration: the project, then its directory. */
export function WorkspaceFields(props: {
  readonly input: AgentWorkspaceInput;
  readonly projects: readonly AgentWorkspaceProject[];
  readonly canBrowse: boolean;
  readonly disabled: boolean;
  readonly onChange: (input: AgentWorkspaceInput) => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const { input } = props;
  return (
    <fieldset disabled={props.disabled} className="space-y-4">
      <label className="block space-y-1.5 text-sm font-medium">
        <span className="block">{t("workspaces.name")}</span>
        <Input
          required
          maxLength={120}
          value={input.name}
          onChange={(event) =>
            props.onChange({ ...input, name: event.target.value })
          }
        />
      </label>
      <WorkspaceProjectStep
        input={input}
        projects={props.projects}
        disabled={props.disabled}
        onChange={props.onChange}
      />
      <WorkspacePathStep
        input={input}
        canBrowse={props.canBrowse}
        disabled={props.disabled}
        onChange={props.onChange}
      />
    </fieldset>
  );
}
