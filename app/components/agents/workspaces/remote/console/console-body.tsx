import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";
import { cn } from "@/app/lib/cn";

import type { RefCallback } from "react";
import type { RemoteConsoleState } from "@/definition/RemoteConsole";

/** Terminal work surface with centered connection and initial failure states. */
export function ConsoleBody(props: {
  readonly container: RefCallback<HTMLDivElement>;
  readonly state: RemoteConsoleState;
  readonly hasConnected: boolean;
  readonly onClose: () => void;
  readonly onReconnect: () => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const { state } = props;
  const isConnecting = state.status === "connecting";
  const isFailed =
    state.status === "blocked" && !props.hasConnected && state.attempts === 0;
  const hasOverlay = isConnecting || isFailed;
  const isHostKeyChanged = state.message === "remote.failure.host_key_changed";
  let title = t(state.message ?? "remote.failure.remote_failed");
  let hint = t("remote.console.failedHint");
  if (isConnecting) {
    title = t("remote.console.connectingTitle");
    hint = t("remote.console.connectingHint");
  } else if (isHostKeyChanged) {
    title = t("remote.console.hostKeyTitle");
    hint = t("remote.console.hostKeyHint");
  }
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
          state.status === "reconnecting" && "opacity-60",
        )}
      />
      {hasOverlay ? (
        <div
          className="absolute inset-0 flex items-center justify-center p-6 text-center"
          role={isFailed ? "alert" : "status"}
        >
          <div className="max-w-lg">
            <h2 className="text-lg font-semibold">{title}</h2>
            <p className="mt-3 text-sm leading-relaxed text-terminal-muted">
              {hint}
            </p>
            {isFailed ? (
              <Button
                className="mt-6"
                onClick={isHostKeyChanged ? props.onClose : props.onReconnect}
              >
                {t(
                  isHostKeyChanged
                    ? "remote.console.reviewConnection"
                    : "remote.console.reconnect",
                )}
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** Input availability and keyboard hints stay visible below the work surface. */
export function ConsoleFooter(props: {
  readonly state: RemoteConsoleState;
}): React.ReactElement {
  const { t } = useTranslation();
  const labels = {
    connecting: "remote.console.inputUnavailable",
    connected: "remote.console.shellEncoding",
    reconnecting: "remote.console.inputPaused",
    blocked: "remote.console.noShell",
    ended: "remote.console.scrollbackOnly",
  } as const;
  return (
    <footer className="flex shrink-0 flex-wrap justify-between gap-2 px-6 py-3.5 text-xs text-muted-foreground">
      <span>{t(labels[props.state.status])}</span>
      <span>{t("remote.console.keyboardHint")}</span>
    </footer>
  );
}
