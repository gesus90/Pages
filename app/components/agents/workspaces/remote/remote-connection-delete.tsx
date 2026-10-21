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
  RemoteConnectionView,
} from "@/definition/RemoteConnection";

/** Confirms the removal of a connection and its stored secrets; profiles must go first. */
export function RemoteConnectionDelete(props: {
  readonly connection: RemoteConnectionView;
  readonly onClose: () => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const fetcher = useFetcher<RemoteActionResult>();
  const { onClose, connection } = props;
  const isPending = fetcher.state !== "idle";
  const isUsed = connection.workspaceCount > 0;
  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.ok) onClose();
  }, [fetcher.state, fetcher.data, onClose]);
  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent size="md">
        <DialogTitle className="text-lg font-semibold">
          {t("remote.connections.removeTitle", { name: connection.name })}
        </DialogTitle>
        <DialogDescription className="mt-1.5 text-sm text-muted-foreground">
          {t(
            isUsed
              ? "remote.connections.removeBlocked"
              : "remote.connections.removeDescription",
          )}
        </DialogDescription>
        <div className="mt-3">
          <RemoteActionMessage result={fetcher.data} />
        </div>
        <fetcher.Form
          method="post"
          action="/agents/workspaces/remote"
          className="mt-6 flex justify-end gap-2"
        >
          <input type="hidden" name="intent" value="delete-connection" />
          <input type="hidden" name="connectionId" value={connection.id} />
          <input type="hidden" name="revision" value={connection.revision} />
          <Button variant="ghost" disabled={isPending} onClick={onClose}>
            {t("remote.dialog.cancel")}
          </Button>
          <Button
            type="submit"
            variant="destructive"
            disabled={isUsed}
            isPending={isPending}
          >
            {t("remote.connections.remove")}
          </Button>
        </fetcher.Form>
      </DialogContent>
    </Dialog>
  );
}
