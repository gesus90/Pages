import * as DialogPrimitive from "@radix-ui/react-dialog";
import { useContext, useEffect, useState } from "react";
import { useBlocker } from "react-router";

import { Dialog } from "@/app/components/ui/dialog";
import { cn } from "@/app/lib/cn";

import { ConsoleCloseDialog } from "./console-close-dialog";
import { ConsoleBody, ConsoleFooter } from "./console-body";
import { consoleActivityContext } from "./console-activity";
import { ConsoleHeading } from "./console-heading";
import { ConsoleStatus } from "./console-status";
import { useRemoteConsole } from "./use-remote-console";

import type { RemoteWorkspaceView } from "@/definition/RemoteConnection";

/** Modal remote shell with a visible lifecycle and confirmation on every panel dismissal. */
export function RemoteConsolePanel(props: {
  readonly workspace: RemoteWorkspaceView;
  readonly onClose: () => void;
}): React.ReactElement {
  const { container, state, hasConnected, reconnect, restart } =
    useRemoteConsole(props.workspace.id);
  const [isConfirming, setConfirming] = useState(false);
  const [isExpanded, setExpanded] = useState(false);
  const { setOpen } = useContext(consoleActivityContext);
  useEffect(() => {
    setOpen(true);
    return () => setOpen(false);
  }, [setOpen]);
  const isActive = state.status !== "ended";
  const blocker = useBlocker(isActive);
  useEffect(() => {
    if (!isActive) return undefined;
    function warn(event: BeforeUnloadEvent): void {
      event.preventDefault();
    }
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [isActive]);
  function confirm(): void {
    if (blocker.state === "blocked") blocker.proceed();
    props.onClose();
  }
  function cancel(): void {
    setConfirming(false);
    if (blocker.state === "blocked") blocker.reset();
  }
  return (
    <>
      <Dialog
        open
        onOpenChange={(open) => {
          if (!open) setConfirming(true);
        }}
      >
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-scrim" />
          <DialogPrimitive.Content
            className={cn(
              "fixed z-50 flex flex-col overflow-hidden rounded-2xl bg-surface shadow-panel outline-none",
              isExpanded
                ? "inset-0 rounded-none"
                : "inset-y-3 right-3 w-[calc(100vw-1.5rem)] sm:top-22 sm:right-6 sm:bottom-6 sm:w-[min(72rem,calc(100vw-3rem))]",
            )}
            onEscapeKeyDown={(event) => {
              event.preventDefault();
              setConfirming(true);
            }}
          >
            <ConsoleHeading
              workspace={props.workspace}
              state={state}
              hasConnected={hasConnected}
              isExpanded={isExpanded}
              onToggleExpanded={() => setExpanded((previous) => !previous)}
              onClose={() => setConfirming(true)}
            />
            <ConsoleStatus
              state={state}
              hasConnected={hasConnected}
              onReconnect={reconnect}
              onRestart={restart}
            />
            <ConsoleBody
              container={container}
              state={state}
              hasConnected={hasConnected}
              onClose={props.onClose}
              onReconnect={reconnect}
            />
            <ConsoleFooter state={state} />
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </Dialog>
      {isConfirming || blocker.state === "blocked" ? (
        <ConsoleCloseDialog
          workspaceName={props.workspace.name}
          onCancel={cancel}
          onConfirm={confirm}
        />
      ) : null}
    </>
  );
}
