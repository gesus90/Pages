import {
  MoreHorizontal,
  Pencil,
  RefreshCw,
  Terminal,
  Trash2,
  Wrench,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useFetcher, useRevalidator } from "react-router";

import { Button } from "@/app/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/app/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/app/components/ui/dropdown-menu";

import {
  connectionConsoleTarget,
  connectionSetupTarget,
} from "./console/console-target";
import { RemoteConsolePanel } from "./console/remote-console-panel";
import { RemoteActionMessage } from "./remote-action-message";
import { RemoteConnectionStatus } from "./remote-connection-status";

import type {
  RemoteActionResult,
  RemoteConnectionView,
} from "@/definition/RemoteConnection";
import type { RemoteInstallView } from "@/definition/RemoteSetup";

/**
 * Edit, test and removal of administrators; a console needs only membership in
 * the shared department. The setup needs both, as it runs a shell with `sudo`.
 */
function RemoteConnectionMenuItems(props: {
  readonly connection: RemoteConnectionView;
  readonly install: RemoteInstallView | undefined;
  readonly onConsole: () => void;
  readonly onSetup: () => void;
  readonly onEdit: () => void;
  readonly onTest: () => void;
  readonly onDelete: () => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const { connection } = props;
  return (
    <>
      {connection.canOpenConsole ? (
        <DropdownMenuItem onSelect={props.onConsole}>
          <Terminal className="mr-2 size-4" aria-hidden="true" />
          {t("remote.console.action")}
        </DropdownMenuItem>
      ) : null}
      {connection.canManage && connection.canOpenConsole ? (
        <RemoteSetupMenuItem install={props.install} onSetup={props.onSetup} />
      ) : null}
      {connection.canManage ? (
        <>
          <DropdownMenuItem onSelect={props.onEdit}>
            <Pencil className="mr-2 size-4" aria-hidden="true" />
            {t("remote.connections.edit")}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={props.onTest}>
            <RefreshCw className="mr-2 size-4" aria-hidden="true" />
            {t("remote.connections.test")}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            className="text-destructive"
            onSelect={props.onDelete}
          >
            <Trash2 className="mr-2 size-4" aria-hidden="true" />
            {t("remote.connections.remove")}
          </DropdownMenuItem>
        </>
      ) : null}
    </>
  );
}

/** The row menu and the console or removal it opens; nobody sees a stored secret. */
function RemoteConnectionActions(props: {
  readonly connection: RemoteConnectionView;
  readonly install: RemoteInstallView | undefined;
  readonly onEdit: () => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const fetcher = useFetcher<RemoteActionResult>();
  const { revalidate } = useRevalidator();
  const [isDeleting, setDeleting] = useState(false);
  const [isConsoleOpen, setConsoleOpen] = useState(false);
  const [isSetupOpen, setSetupOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const { connection } = props;
  function handleTest(): void {
    void fetcher.submit(
      { intent: "check-connection", connectionId: connection.id },
      { method: "post", action: "/agents/workspaces/remote" },
    );
  }
  // A refused sign-in, key or terminal is checked where the connection is managed.
  function handleReview(): void {
    setConsoleOpen(false);
    setSetupOpen(false);
    if (connection.canManage) handleTest();
  }
  // A finished setup changes what the table shows, so it is loaded again.
  function handleSetupClose(): void {
    setSetupOpen(false);
    void revalidate();
  }
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild ref={trigger}>
          <Button
            size="icon-sm"
            variant="ghost"
            data-console-open={isConsoleOpen || isSetupOpen}
            aria-label={t("remote.connections.actionsFor", {
              name: connection.name,
            })}
          >
            <MoreHorizontal className="size-4" aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          <RemoteConnectionMenuItems
            connection={connection}
            install={props.install}
            onConsole={() => setConsoleOpen(true)}
            onSetup={() => setSetupOpen(true)}
            onEdit={props.onEdit}
            onTest={handleTest}
            onDelete={() => setDeleting(true)}
          />
        </DropdownMenuContent>
      </DropdownMenu>
      {isDeleting ? (
        <RemoteConnectionDelete
          connection={connection}
          onClose={() => setDeleting(false)}
        />
      ) : null}
      {isConsoleOpen ? (
        <RemoteConsolePanel
          target={connectionConsoleTarget(connection)}
          onClose={() => setConsoleOpen(false)}
          onReview={handleReview}
          returnFocus={trigger}
        />
      ) : null}
      {isSetupOpen ? (
        <RemoteConsolePanel
          target={connectionSetupTarget(connection)}
          onClose={handleSetupClose}
          onReview={handleReview}
          returnFocus={trigger}
        />
      ) : null}
    </>
  );
}

/** One connection: name, SSH access, shared department, live status and actions. */
export function RemoteConnectionRow(props: {
  readonly connection: RemoteConnectionView;
  readonly install: RemoteInstallView | undefined;
  readonly hasActions: boolean;
  readonly onEdit: () => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const { connection } = props;
  return (
    <tr className="align-top">
      <th scope="row" className="px-4 py-3 text-left font-medium">
        <span className="pages-selectable block">{connection.name}</span>
        <span className="block text-xs font-normal text-muted-foreground">
          {t("remote.connections.workspaceCount", {
            count: connection.workspaceCount,
          })}
        </span>
      </th>
      <td className="px-4 py-3">
        <span className="pages-selectable block font-mono break-all">
          {connection.username}@{connection.host}:{connection.port}
        </span>
        <span className="block text-xs text-muted-foreground">
          {t(`remote.authMethod.${connection.authMethod}`)}
        </span>
      </td>
      <td className="px-4 py-3">
        {connection.departmentName ?? (
          <span className="text-warning">
            {t("remote.connections.departmentRemoved")}
          </span>
        )}
      </td>
      <td className="max-w-80 px-4 py-3">
        <RemoteConnectionStatus connection={connection} />
      </td>
      {props.hasActions ? (
        <td className="px-4 py-3">
          {connection.canManage || connection.canOpenConsole ? (
            <RemoteConnectionActions
              connection={connection}
              install={props.install}
              onEdit={props.onEdit}
            />
          ) : null}
        </td>
      ) : null}
    </tr>
  );
}

function menuTextKey(install: RemoteInstallView | undefined): string {
  if (install?.state === "confirmed") return "remote.setup.menu.installed";
  if (install?.state === "running") return "remote.setup.menu.running";
  return "remote.setup.menu.runner";
}

function RemoteSetupMenuItem(props: {
  readonly install: RemoteInstallView | undefined;
  readonly onSetup: () => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const isOff =
    props.install?.state === "confirmed" || props.install?.state === "running";
  return (
    <>
      <DropdownMenuLabel className="px-3 pt-2 pb-1 text-xs font-medium text-muted-foreground">
        {t("remote.setup.menu.heading")}
      </DropdownMenuLabel>
      <DropdownMenuItem disabled={isOff} onSelect={props.onSetup}>
        <Wrench className="mr-2 size-4" aria-hidden="true" />
        {t(menuTextKey(props.install))}
      </DropdownMenuItem>
    </>
  );
}

function RemoteConnectionDelete(props: {
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
