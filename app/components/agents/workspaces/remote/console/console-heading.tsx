import { Maximize, Minimize, Terminal, X } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";
import { DialogDescription, DialogTitle } from "@/app/components/ui/dialog";

import { ConsoleConnectionStatus } from "./console-status";

import type { RemoteConsoleState } from "@/definition/RemoteConsole";
import type { RemoteWorkspaceView } from "@/definition/RemoteConnection";

/** Identifies the SSH destination and workspace beside the connection and panel controls. */
export function ConsoleHeading(props: {
  readonly workspace: RemoteWorkspaceView;
  readonly state: RemoteConsoleState;
  readonly hasConnected: boolean;
  readonly isExpanded: boolean;
  readonly onToggleExpanded: () => void;
  readonly onClose: () => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const ExpandIcon = props.isExpanded ? Minimize : Maximize;
  return (
    <header className="shrink-0 space-y-4 px-6 pt-6 pb-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary-subtle text-primary">
            <Terminal className="size-5" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <DialogTitle className="text-base font-semibold">
              {t("remote.console.title", { name: props.workspace.name })}
            </DialogTitle>
            <DialogDescription className="mt-1 text-xs text-muted-foreground">
              {props.workspace.connectionName}
            </DialogDescription>
          </div>
        </div>
        <div className="ml-auto flex items-center gap-3">
          <ConsoleConnectionStatus
            state={props.state}
            hasConnected={props.hasConnected}
          />
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label={t(
              props.isExpanded
                ? "remote.console.restore"
                : "remote.console.expand",
            )}
            aria-pressed={props.isExpanded}
            onClick={props.onToggleExpanded}
          >
            <ExpandIcon className="size-4" aria-hidden="true" />
          </Button>
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label={t("remote.console.close")}
            onClick={props.onClose}
          >
            <X className="size-4" aria-hidden="true" />
          </Button>
        </div>
      </div>
      <dl className="flex flex-wrap gap-x-6 gap-y-2 text-xs">
        {props.workspace.consoleAddress ? (
          <div className="flex min-w-0 gap-3">
            <dt className="text-muted-foreground">SSH</dt>
            <dd className="pages-selectable font-mono break-all">
              {props.workspace.consoleAddress}
            </dd>
          </div>
        ) : null}
        <div className="flex min-w-0 gap-3">
          <dt className="text-muted-foreground">
            {t("remote.console.directory")}
          </dt>
          <dd className="pages-selectable font-mono break-all">
            {props.workspace.path}
          </dd>
        </div>
      </dl>
    </header>
  );
}
