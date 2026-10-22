import { Network, Plus } from "lucide-react";
import { useContext, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useRevalidator } from "react-router";

import { SettingsCard } from "@/app/components/settings/settings-layout";
import { Button } from "@/app/components/ui/button";
import { Dialog } from "@/app/components/ui/dialog";
import { HorizontalScrollArea } from "@/app/components/ui/horizontal-scroll-area";

import { RemoteConnectionDialog } from "./remote-connection-dialog";
import { RemoteConnectionRow } from "./remote-connection-row";
import { consoleActivityContext } from "./console/console-activity";

import type {
  RemoteConnectionView,
  RemoteOverview,
} from "@/definition/RemoteConnection";

const COLUMNS = ["connection", "access", "department", "status"] as const;
const ACTIVE_POLL_MILLISECONDS = 3_000;
const CONNECTED_POLL_MILLISECONDS = 10_000;

function isInMotion(connection: RemoteConnectionView): boolean {
  const { status } = connection.session;
  return (
    connection.isChecking ||
    status === "connecting" ||
    status === "reconnecting"
  );
}

/** How often the page reloads; `null` when nothing can change on its own. */
function pollInterval(overview: RemoteOverview): number | null {
  if (overview.connections.some(isInMotion)) return ACTIVE_POLL_MILLISECONDS;
  // An open connection can lose its transport at any time; the series must show up.
  if (
    overview.connections.some(
      (connection) => connection.session.status === "connected",
    )
  )
    return CONNECTED_POLL_MILLISECONDS;
  return null;
}

/** Reloads the page while a test runs or a connection is open, so a series, its count and next attempt stay current. */
function useRemotePolling(overview: RemoteOverview): void {
  const { revalidate } = useRevalidator();
  const { isOpen } = useContext(consoleActivityContext);
  const interval = isOpen ? null : pollInterval(overview);
  useEffect(() => {
    if (interval === null) return undefined;
    const timer = window.setInterval(() => {
      void revalidate();
    }, interval);
    return () => window.clearInterval(timer);
  }, [interval, revalidate]);
}

function RemoteConnectionTable(props: {
  readonly connections: readonly RemoteConnectionView[];
  readonly onEdit: (connection: RemoteConnectionView) => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const hasActions = props.connections.some((entry) => entry.canManage);
  const columns: string[] = [...COLUMNS];
  if (hasActions) columns.push("actions");
  return (
    <HorizontalScrollArea>
      <table className="w-full text-left text-sm">
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column} scope="col" className="px-4 py-3">
                {t(`remote.connections.columns.${column}`)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border/60">
          {props.connections.map((connection) => (
            <RemoteConnectionRow
              key={connection.id}
              connection={connection}
              hasActions={hasActions}
              onEdit={() => props.onEdit(connection)}
            />
          ))}
        </tbody>
      </table>
    </HorizontalScrollArea>
  );
}

/**
 * Lists the SSH connections the person may use; administrators add, edit,
 * test and remove them in the connection dialog.
 */
export function RemoteConnectionsCard(props: {
  readonly overview: RemoteOverview;
}): React.ReactElement {
  const { t } = useTranslation();
  const { overview } = props;
  const [selected, setSelected] = useState<RemoteConnectionView | "new" | null>(
    null,
  );
  useRemotePolling(overview);
  function close(): void {
    setSelected(null);
  }
  return (
    <SettingsCard
      icon={<Network className="size-5" />}
      title={t("remote.connections.title")}
      description={t("remote.connections.description")}
      wrapHeader
      action={
        overview.canManageConnections ? (
          <Button size="sm" onClick={() => setSelected("new")}>
            <Plus className="size-4" aria-hidden="true" />
            {t("remote.connections.add")}
          </Button>
        ) : undefined
      }
    >
      {overview.connections.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">
          {t(
            overview.canManageConnections
              ? "remote.connections.empty"
              : "remote.connections.emptyUser",
          )}
        </p>
      ) : (
        <RemoteConnectionTable
          connections={overview.connections}
          onEdit={setSelected}
        />
      )}
      <Dialog
        open={selected !== null}
        onOpenChange={(open) => {
          if (!open) close();
        }}
      >
        {selected !== null ? (
          <RemoteConnectionDialog
            connection={selected === "new" ? null : selected}
            departments={overview.departments}
            onClose={close}
          />
        ) : null}
      </Dialog>
    </SettingsCard>
  );
}
