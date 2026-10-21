import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useFetcher } from "react-router";

import { Button } from "@/app/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/app/components/ui/dialog";

import { RemoteActionMessage } from "./remote-action-message";

import type {
  RemoteActionResult,
  RemoteWorkspaceView,
} from "@/definition/RemoteConnection";

/** Confirms unregistering a remote profile; the remote directory stays untouched. */
export function RemoteWorkspaceDelete(props: {
  readonly workspace: RemoteWorkspaceView;
  readonly onClose: () => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const fetcher = useFetcher<RemoteActionResult>();
  const { onClose, workspace } = props;
  const isPending = fetcher.state !== "idle";
  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.ok) onClose();
  }, [fetcher.state, fetcher.data, onClose]);
  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent size="md">
        <DialogTitle className="text-lg font-semibold">
          {t("workspaces.unregisterTitle", { name: workspace.name })}
        </DialogTitle>
        <DialogDescription className="mt-1.5 text-sm text-muted-foreground">
          {t("remote.workspace.unregisterDescription")}
        </DialogDescription>
        <div className="mt-3">
          <RemoteActionMessage result={fetcher.data} />
        </div>
        <fetcher.Form
          method="post"
          action="/agents/workspaces/remote"
          className="mt-6 flex justify-end gap-2"
        >
          <input type="hidden" name="intent" value="delete-remote-workspace" />
          <input type="hidden" name="workspaceId" value={workspace.id} />
          <input type="hidden" name="revision" value={workspace.revision} />
          <Button variant="ghost" disabled={isPending} onClick={onClose}>
            {t("settings.agents.cancel")}
          </Button>
          <Button type="submit" variant="destructive" isPending={isPending}>
            {t("workspaces.unregister")}
          </Button>
        </fetcher.Form>
      </DialogContent>
    </Dialog>
  );
}
