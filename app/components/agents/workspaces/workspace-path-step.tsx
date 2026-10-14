import { FolderOpen } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";
import { Dialog } from "@/app/components/ui/dialog";
import { Input } from "@/app/components/ui/input";

import { WorkspaceFolderBrowser } from "./workspace-folder-browser";
import { WorkspaceFolderNotice } from "./workspace-folder-notice";
import { WorkspaceStep } from "./workspace-step";

import type { AgentWorkspaceInput } from "@/definition/AgentWorkspace";

/** The last part of a path, which names a workspace until a person names it. */
function folderName(path: string): string {
  return (path.split(/[\\/]/u).filter(Boolean).at(-1) ?? "").slice(0, 120);
}

/** The directory is typed or picked in the server's folder browser; the pick fills the same field. */
export function WorkspacePathStep(props: {
  readonly input: AgentWorkspaceInput;
  /** Only people who may register a workspace are offered the server's folders. */
  readonly canBrowse: boolean;
  readonly disabled: boolean;
  readonly onChange: (input: AgentWorkspaceInput) => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const [isBrowsing, setBrowsing] = useState(false);
  const { input } = props;
  function handleSelect(path: string): void {
    setBrowsing(false);
    props.onChange({
      ...input,
      path,
      name: input.name.trim() ? input.name : folderName(path),
    });
  }
  return (
    <WorkspaceStep number={2} title={t("workspaces.path")}>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input
          required
          maxLength={4096}
          aria-label={t("workspaces.path")}
          placeholder="/srv/projects/example"
          spellCheck={false}
          autoComplete="off"
          value={input.path}
          onChange={(event) =>
            props.onChange({ ...input, path: event.target.value })
          }
        />
        {props.canBrowse ? (
          <Button
            type="button"
            variant="outline"
            className="shrink-0"
            disabled={props.disabled}
            onClick={() => setBrowsing(true)}
          >
            <FolderOpen className="size-4" aria-hidden="true" />
            {t("workspaces.chooseFolder")}
          </Button>
        ) : null}
      </div>
      {input.path.trim() ? null : (
        <WorkspaceFolderNotice tone="neutral">
          {t("workspaces.pathMissing")}
        </WorkspaceFolderNotice>
      )}
      <p className="text-xs text-muted-foreground">
        {t("workspaces.pathHint")}
      </p>
      <Dialog open={isBrowsing} onOpenChange={setBrowsing}>
        {isBrowsing ? (
          <WorkspaceFolderBrowser
            startPath={input.path}
            onSelect={handleSelect}
            onClose={() => setBrowsing(false)}
          />
        ) : null}
      </Dialog>
    </WorkspaceStep>
  );
}
