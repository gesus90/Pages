import { useId } from "react";
import { useTranslation } from "react-i18next";

import { Input } from "@/app/components/ui/input";
import { Select } from "@/app/components/ui/select";

import { WorkspaceStep } from "../workspace-step";

import type { RemoteConnectionChoice } from "@/definition/RemoteConnection";
import type { WorkspaceDraft } from "../use-workspace-form";

/**
 * The connection and the absolute path on its machine.
 *
 * @remarks
 * Saving checks the directory over the chosen connection, within its
 * allowed directories; a typed `host:path` is no connection and is refused.
 */
export function RemotePathStep(props: {
  readonly input: WorkspaceDraft;
  readonly connections: readonly RemoteConnectionChoice[];
  /** A registered profile stays on its connection. */
  readonly isConnectionFixed: boolean;
  readonly disabled: boolean;
  readonly onChange: (change: Partial<WorkspaceDraft>) => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const id = useId();
  const { input } = props;
  const selected = props.connections.find(
    (connection) => connection.id === input.connectionId,
  );
  const options = props.connections.map((connection) => ({
    value: connection.id,
    label: connection.hasHostKey
      ? `${connection.name} · ${connection.host}`
      : t("remote.workspace.connectionUnconfirmed", { name: connection.name }),
    disabled: !connection.hasHostKey,
  }));
  return (
    <WorkspaceStep number={2} title={t("remote.workspace.pathTitle")}>
      <div className="space-y-1.5 text-sm">
        <label htmlFor={`${id}-connection`} className="block font-medium">
          {t("remote.workspace.connection")}
        </label>
        <Select
          id={`${id}-connection`}
          size="default"
          className="w-full"
          disabled={props.disabled || props.isConnectionFixed}
          value={input.connectionId}
          onValueChange={(connectionId) => props.onChange({ connectionId })}
          options={[
            { value: "", label: t("remote.workspace.chooseConnection") },
            ...options,
          ]}
        />
      </div>
      <div className="space-y-1.5 text-sm">
        <label htmlFor={`${id}-path`} className="block font-medium">
          {t("remote.workspace.path")}
        </label>
        <Input
          id={`${id}-path`}
          required
          maxLength={4096}
          placeholder="/srv/projects/example"
          spellCheck={false}
          autoComplete="off"
          value={input.path}
          onChange={(event) => props.onChange({ path: event.target.value })}
        />
      </div>
      {selected ? (
        <p className="text-xs text-muted-foreground">
          {t("remote.workspace.allowedRoots")}{" "}
          <span className="pages-selectable font-mono break-all">
            {selected.allowedRoots.join(", ")}
          </span>
        </p>
      ) : null}
      <p className="text-xs text-muted-foreground">
        {t("remote.workspace.pathHint")}
      </p>
    </WorkspaceStep>
  );
}
