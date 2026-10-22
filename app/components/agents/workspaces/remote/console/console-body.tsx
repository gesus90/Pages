import {
  Lock,
  RadioOff,
  RefreshCw,
  ShieldAlert,
  Terminal,
  TriangleAlert,
} from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";
import { cn } from "@/app/lib/cn";
import { CONSOLE_MAXIMUM_RETRIES } from "@/definition/RemoteConsole";

import { OVERLAY_CONSOLE_VIEWS } from "./console-view";

import type { LucideIcon } from "lucide-react";
import type { RefCallback } from "react";
import type { RemoteConsoleState } from "@/definition/RemoteConsole";
import type { RemoteConsoleTarget } from "./console-target";
import type { ConsoleView } from "./console-view";

/** What a person can do from a centered state message. */
type OverlayAction = "review" | "reconnect" | "close" | null;

interface OverlayContent {
  readonly icon: LucideIcon;
  readonly action: OverlayAction;
}

const OVERLAYS: Partial<Record<ConsoleView, OverlayContent>> = {
  connecting: { icon: RefreshCw, action: null },
  authFailed: { icon: Lock, action: "review" },
  hostKeyChanged: { icon: ShieldAlert, action: "review" },
  unreachable: { icon: RadioOff, action: "reconnect" },
  ptyUnavailable: { icon: Terminal, action: "review" },
  accessRevoked: { icon: ShieldAlert, action: "close" },
  failed: { icon: TriangleAlert, action: "reconnect" },
};
const ACTION_LABELS = {
  review: "remote.console.review",
  reconnect: "remote.console.reconnect",
  close: "remote.console.closeConsole",
} as const;
const FOOTER_LABELS: Record<ConsoleView, string> = {
  connecting: "remote.console.footer.connecting",
  connected: "remote.console.footer.connected",
  reconnecting: "remote.console.footer.reconnecting",
  lost: "remote.console.footer.lost",
  exited: "remote.console.footer.exited",
  authFailed: "remote.console.footer.noShell",
  hostKeyChanged: "remote.console.footer.hostKeyChanged",
  unreachable: "remote.console.footer.noShell",
  ptyUnavailable: "remote.console.footer.ptyUnavailable",
  accessRevoked: "remote.console.footer.accessRevoked",
  failed: "remote.console.footer.noShell",
};

/** The retry budget of a session is spent; only a new session can try again. */
function overlayAction(
  content: OverlayContent,
  state: RemoteConsoleState,
): OverlayAction {
  if (content.action !== "reconnect") return content.action;
  return state.attempts < CONSOLE_MAXIMUM_RETRIES ? "reconnect" : "close";
}

function OverlayHint(props: {
  readonly target: RemoteConsoleTarget;
  readonly state: RemoteConsoleState;
  readonly view: ConsoleView;
}): React.ReactElement {
  const { t } = useTranslation();
  const { state, view } = props;
  const text =
    view === "failed"
      ? t(state.message ?? "remote.failure.remote_failed")
      : t(`remote.console.overlay.${view}.hint`, {
          name: props.target.hostName,
          endpoint: props.target.endpointLabel ?? props.target.hostName,
        });
  return (
    <>
      <p className="mt-3 text-sm leading-relaxed text-terminal-muted">{text}</p>
      {view === "connecting" && state.attempts > 0 ? (
        <p className="mt-2 text-xs text-terminal-muted">
          {t("remote.console.attempt", {
            attempt: state.attempts,
            maximum: CONSOLE_MAXIMUM_RETRIES,
          })}
        </p>
      ) : null}
    </>
  );
}

/** A centered state message in place of the terminal: connecting or why no shell is open. */
function ConsoleOverlay(props: {
  readonly target: RemoteConsoleTarget;
  readonly state: RemoteConsoleState;
  readonly view: ConsoleView;
  readonly onAction: (action: Exclude<OverlayAction, null>) => void;
}): React.ReactElement | null {
  const { t } = useTranslation();
  const content = OVERLAYS[props.view];
  if (!content) return null;
  const Icon = content.icon;
  const action = overlayAction(content, props.state);
  const isConnecting = props.view === "connecting";
  return (
    <div
      className="absolute inset-0 flex items-center justify-center p-6 text-center"
      role={isConnecting ? "status" : "alert"}
    >
      <div className="max-w-lg">
        <Icon
          aria-hidden="true"
          className={cn(
            "mx-auto size-8 text-terminal-muted",
            isConnecting && "motion-safe:animate-spin",
          )}
        />
        <h2 className="mt-4 text-lg font-semibold">
          {t(`remote.console.overlay.${props.view}.title`, {
            name: props.target.hostName,
          })}
        </h2>
        <OverlayHint
          target={props.target}
          state={props.state}
          view={props.view}
        />
        {action ? (
          <Button className="mt-6" onClick={() => props.onAction(action)}>
            {t(ACTION_LABELS[action])}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

/** Terminal work surface with centered connection and failure states. */
export function ConsoleBody(props: {
  readonly container: RefCallback<HTMLDivElement>;
  readonly target: RemoteConsoleTarget;
  readonly state: RemoteConsoleState;
  readonly view: ConsoleView;
  readonly onAction: (action: Exclude<OverlayAction, null>) => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const hasOverlay = OVERLAY_CONSOLE_VIEWS.has(props.view);
  return (
    <div className="relative min-h-0 flex-1 bg-terminal-surface text-terminal-foreground">
      <div
        ref={props.container}
        aria-label={t("remote.console.terminalLabel")}
        aria-hidden={hasOverlay}
        inert={hasOverlay}
        className={cn(
          "absolute inset-6 overflow-hidden",
          hasOverlay && "invisible",
          props.view === "reconnecting" && "opacity-60",
        )}
      />
      <ConsoleOverlay
        target={props.target}
        state={props.state}
        view={props.view}
        onAction={props.onAction}
      />
    </div>
  );
}

/** Input availability and keyboard hints stay visible below the work surface. */
export function ConsoleFooter(props: {
  readonly view: ConsoleView;
}): React.ReactElement {
  const { t } = useTranslation();
  return (
    <footer className="flex shrink-0 flex-wrap justify-between gap-x-4 gap-y-1 bg-surface px-6 py-3.5 text-xs leading-4.5 text-muted-foreground">
      <span>{t(FOOTER_LABELS[props.view])}</span>
      <span>{t("remote.console.keyboardHint")}</span>
    </footer>
  );
}
