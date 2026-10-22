import {
  MoreHorizontal,
  Pencil,
  RefreshCw,
  Terminal,
  Trash2,
} from "lucide-react";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useFetcher } from "react-router";

import { Button } from "@/app/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/app/components/ui/dropdown-menu";

import { connectionConsoleTarget } from "./console/console-target";
import { RemoteConsolePanel } from "./console/remote-console-panel";
import { RemoteConnectionDelete } from "./remote-connection-delete";
import { RemoteConnectionStatus } from "./remote-connection-status";

import type {
  RemoteActionResult,
  RemoteConnectionView,
} from "@/definition/RemoteConnection";

/** Edit, test and removal of administrators; a console needs only membership in the shared department. */
function RemoteConnectionMenuItems(props: {
  readonly connection: RemoteConnectionView;
  readonly onConsole: () => void;
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
  readonly onEdit: () => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const fetcher = useFetcher<RemoteActionResult>();
  const [isDeleting, setDeleting] = useState(false);
  const [isConsoleOpen, setConsoleOpen] = useState(false);
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
    if (connection.canManage) handleTest();
  }
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild ref={trigger}>
          <Button
            size="icon-sm"
            variant="ghost"
            data-console-open={isConsoleOpen}
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
            onConsole={() => setConsoleOpen(true)}
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
    </>
  );
}

/** One connection: name, SSH access, shared department, live status and actions. */
export function RemoteConnectionRow(props: {
  readonly connection: RemoteConnectionView;
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
              onEdit={props.onEdit}
            />
          ) : null}
        </td>
      ) : null}
    </tr>
  );
}
