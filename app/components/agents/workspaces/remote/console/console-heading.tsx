import { Maximize, Minimize, Terminal, X } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";
import { DialogDescription, DialogTitle } from "@/app/components/ui/dialog";

import { ConsoleConnectionStatus } from "./console-status";
import { OVERLAY_CONSOLE_VIEWS } from "./console-view";

import type { RemoteConsoleState } from "@/definition/RemoteConsole";
import type { RemoteConsoleTarget } from "./console-target";
import type { ConsoleView } from "./console-view";

/** The start directory as far as it is known in this view. */
function useDirectoryText(
  target: RemoteConsoleTarget,
  state: RemoteConsoleState,
  view: ConsoleView,
): string {
  const { t } = useTranslation();
  const directory = state.directory ?? target.directory;
  if (view === "connecting")
    return directory ?? t("remote.console.directoryPending");
  if (OVERLAY_CONSOLE_VIEWS.has(view))
    return t("remote.console.directoryUnavailable");
  return directory ?? t("remote.console.directoryUnavailable");
}

/** The title and the line below it; a setup names itself, a shell its place. */
function useHeadingTexts(target: RemoteConsoleTarget): {
  readonly title: string;
  readonly description: string;
} {
  const { t } = useTranslation();
  if (target.kind === "setup")
    return {
      title: t("remote.setup.title", { name: target.title }),
      description: t("remote.setup.description"),
    };
  return {
    title: t("remote.console.title", { name: target.title }),
    description:
      target.kind === "connection"
        ? t("remote.console.directConnection")
        : t("remote.console.workspaceOn", { name: target.hostName }),
  };
}

function ConsoleDetail(props: {
  readonly label: string;
  readonly children: string;
}): React.ReactElement {
  return (
    <div className="flex min-w-0 gap-3">
      <dt className="text-muted-foreground">{props.label}</dt>
      <dd className="pages-selectable font-mono break-all">{props.children}</dd>
    </div>
  );
}

/** Identifies the SSH destination and start directory beside the connection and panel controls. */
export function ConsoleHeading(props: {
  readonly target: RemoteConsoleTarget;
  readonly state: RemoteConsoleState;
  readonly view: ConsoleView;
  readonly isExpanded: boolean;
  readonly onToggleExpanded: () => void;
  readonly onClose: () => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const { target } = props;
  const ExpandIcon = props.isExpanded ? Minimize : Maximize;
  const directory = useDirectoryText(target, props.state, props.view);
  const texts = useHeadingTexts(target);
  return (
    <header className="shrink-0 space-y-5 bg-surface px-6 pt-6 pb-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary-subtle text-primary">
            <Terminal className="size-4" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <DialogTitle className="text-lg leading-6 font-semibold">
              {texts.title}
            </DialogTitle>
            <DialogDescription className="mt-1 text-xs text-muted-foreground">
              {texts.description}
            </DialogDescription>
          </div>
        </div>
        <div className="ml-auto flex items-center gap-3">
          <ConsoleConnectionStatus state={props.state} view={props.view} />
          <Button
            size="icon"
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
            size="icon"
            variant="ghost"
            aria-label={t("remote.console.close")}
            onClick={props.onClose}
          >
            <X className="size-4" aria-hidden="true" />
          </Button>
        </div>
      </div>
      <dl className="flex flex-wrap gap-x-7 gap-y-2 text-xs leading-5">
        {target.address ? (
          <ConsoleDetail label={t("remote.console.address")}>
            {target.address}
          </ConsoleDetail>
        ) : null}
        <ConsoleDetail label={t("remote.console.directory")}>
          {directory}
        </ConsoleDetail>
      </dl>
    </header>
  );
}
