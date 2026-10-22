import * as DialogPrimitive from "@radix-ui/react-dialog";
import { useContext, useEffect, useRef, useState } from "react";
import { useBlocker } from "react-router";

import { Dialog } from "@/app/components/ui/dialog";
import { cn } from "@/app/lib/cn";

import { ConsoleCloseDialog } from "./console-close-dialog";
import { ConsoleBody, ConsoleFooter } from "./console-body";
import { consoleActivityContext } from "./console-activity";
import { ConsoleHeading } from "./console-heading";
import { ConsoleBanner } from "./console-status";
import { SetupProgressPanel } from "./setup-progress";
import { ACTIVE_CONSOLE_VIEWS, consoleViewOf } from "./console-view";
import { useRemoteConsole } from "./use-remote-console";

import type { RefObject } from "react";
import type { RemoteConsoleTarget } from "./console-target";

/** Centered 1152 × 816 px on desktop, always inside smaller viewports. */
const CENTERED_PANEL =
  "top-1/2 left-1/2 h-[min(51rem,calc(100dvh-2rem))] w-[min(72rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-2xl";

/** Confirmation, navigation guard and page-leave warning while a shell is active. */
function useConsoleClosing(
  isActive: boolean,
  onClose: () => void,
): {
  readonly isConfirming: boolean;
  readonly request: () => void;
  readonly confirm: () => void;
  readonly cancel: () => void;
} {
  const [isConfirming, setConfirming] = useState(false);
  const blocker = useBlocker(isActive);
  useEffect(() => {
    if (!isActive) return undefined;
    function warn(event: BeforeUnloadEvent): void {
      event.preventDefault();
    }
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [isActive]);
  return {
    isConfirming: isConfirming || blocker.state === "blocked",
    request: () => {
      if (isActive) setConfirming(true);
      else onClose();
    },
    confirm: () => {
      if (blocker.state === "blocked") blocker.proceed();
      onClose();
    },
    cancel: () => {
      setConfirming(false);
      if (blocker.state === "blocked") blocker.reset();
    },
  };
}

/** The console follows its own transport, so table polling pauses while it is open. */
function usePollingPause(): void {
  const { setOpen } = useContext(consoleActivityContext);
  useEffect(() => {
    setOpen(true);
    return () => setOpen(false);
  }, [setOpen]);
}

/**
 * One modal remote shell: a single centered focus panel with header, terminal
 * and footer, and every connection state in place.
 *
 * @remarks
 * Focus moves into the panel, stays there and returns to `returnFocus` when
 * it closes. Escape and the close button end an active shell only after a
 * confirmation; a click on the dimmed page does nothing.
 */
export function RemoteConsolePanel(props: {
  readonly target: RemoteConsoleTarget;
  readonly onClose: () => void;
  /** Checks the connection after a refused sign-in, host key or terminal. */
  readonly onReview: () => void;
  readonly returnFocus: RefObject<HTMLElement | null>;
}): React.ReactElement {
  const shell = useRemoteConsole(props.target.endpoint);
  const view = consoleViewOf(shell.state, shell.hasConnected);
  const closing = useConsoleClosing(
    ACTIVE_CONSOLE_VIEWS.has(view),
    props.onClose,
  );
  const [isExpanded, setExpanded] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  usePollingPause();
  // After a confirmation the work continues where it was; a closed panel keeps no focus.
  function focusConsole(): void {
    if (view === "connected") shell.focus();
    else panel.current?.focus();
  }
  function handleAction(action: "review" | "reconnect" | "close"): void {
    if (action === "reconnect") shell.reconnect();
    if (action === "review") props.onReview();
    if (action === "close") props.onClose();
  }
  return (
    <>
      <Dialog
        open
        onOpenChange={(open) => {
          if (!open) closing.request();
        }}
      >
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-scrim" />
          <DialogPrimitive.Content
            ref={panel}
            className={cn(
              "fixed z-50 flex flex-col overflow-hidden bg-surface shadow-panel outline-none",
              isExpanded ? "inset-0" : CENTERED_PANEL,
            )}
            onOpenAutoFocus={(event) => {
              // The terminal takes the focus once its shell is ready.
              event.preventDefault();
              panel.current?.focus();
            }}
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              props.returnFocus.current?.focus();
            }}
            onEscapeKeyDown={(event) => {
              event.preventDefault();
              closing.request();
            }}
            onPointerDownOutside={(event) => event.preventDefault()}
          >
            <ConsoleHeading
              target={props.target}
              state={shell.state}
              view={view}
              isExpanded={isExpanded}
              onToggleExpanded={() => setExpanded((previous) => !previous)}
              onClose={closing.request}
            />
            {props.target.kind === "setup" ? (
              <SetupProgressPanel
                state={shell.state}
                view={view}
                hostName={props.target.hostName}
              />
            ) : null}
            <ConsoleBanner
              state={shell.state}
              view={view}
              isSetup={props.target.kind === "setup"}
              onRestart={shell.restart}
            />
            <ConsoleBody
              container={shell.container}
              target={props.target}
              state={shell.state}
              view={view}
              onAction={handleAction}
            />
            <ConsoleFooter view={view} kind={props.target.kind} />
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </Dialog>
      {closing.isConfirming ? (
        <ConsoleCloseDialog
          hostName={props.target.hostName}
          isSetup={props.target.kind === "setup"}
          onCancel={closing.cancel}
          onConfirm={closing.confirm}
          onReturnFocus={focusConsole}
        />
      ) : null}
    </>
  );
}
