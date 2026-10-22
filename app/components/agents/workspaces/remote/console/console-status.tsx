import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";
import { cn } from "@/app/lib/cn";
import { CONSOLE_MAXIMUM_RETRIES } from "@/definition/RemoteConsole";

import type { RemoteConsoleState } from "@/definition/RemoteConsole";

/** Compact lifecycle label in the console header. */
export function ConsoleConnectionStatus(props: {
  readonly state: RemoteConsoleState;
  readonly hasConnected: boolean;
}): React.ReactElement {
  const { t } = useTranslation();
  const { status, message, attempts } = props.state;
  const isFailed =
    status === "blocked" && !props.hasConnected && attempts === 0;
  let label = t(`remote.console.status.${status}`);
  if (status === "reconnecting") label = t("remote.console.interrupted");
  if (isFailed) label = t("remote.console.failed");
  return (
    <span
      role="status"
      aria-live="polite"
      className={cn(
        "flex items-center gap-1.5 text-sm text-muted-foreground",
        status === "connected" && "text-success",
        status === "reconnecting" && "text-warning",
        (isFailed || message === "remote.failure.host_key_changed") &&
          "text-destructive",
      )}
    >
      {status === "connected" ? (
        <span aria-hidden="true" className="size-1.5 rounded-full bg-success" />
      ) : null}
      {label}
    </span>
  );
}

function ConsoleLifecycleDetails(props: {
  readonly state: RemoteConsoleState;
}): React.ReactElement {
  const { t } = useTranslation();
  const { state } = props;
  const isEnded = state.status === "ended";
  const shouldShowAttempts =
    !isEnded && (state.attempts > 0 || state.status === "reconnecting");
  return (
    <div>
      <p
        className={cn(
          "text-sm font-medium text-muted-foreground",
          !isEnded && "text-warning",
        )}
      >
        {t(`remote.console.status.${state.status}`)}
        {shouldShowAttempts
          ? ` · ${t("remote.console.attempts", { count: Math.max(1, state.attempts), maximum: CONSOLE_MAXIMUM_RETRIES })}`
          : null}
      </p>
      <p className="mt-1 text-xs text-muted-foreground">
        {isEnded
          ? t("remote.console.endedHint", { code: state.exitCode ?? "—" })
          : t("remote.console.reconnectHint")}
      </p>
      {state.message && state.status !== "reconnecting" ? (
        <p className="mt-1 text-xs text-muted-foreground">{t(state.message)}</p>
      ) : null}
    </div>
  );
}

/** Keeps scrollback visible during reconnects and after the shell exits. */
export function ConsoleStatus(props: {
  readonly state: RemoteConsoleState;
  readonly hasConnected: boolean;
  readonly onReconnect: () => void;
  readonly onRestart: () => void;
}): React.ReactElement | null {
  const { t } = useTranslation();
  const { state } = props;
  if (state.status === "connected" || state.status === "connecting")
    return null;
  if (state.status === "blocked" && !props.hasConnected && state.attempts === 0)
    return null;
  const isEnded = state.status === "ended";
  const canReconnect =
    state.status === "blocked" &&
    state.attempts < CONSOLE_MAXIMUM_RETRIES &&
    state.message !== "remote.failure.host_key_changed";
  return (
    <div
      className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-border px-6 py-4"
      role="status"
      aria-live="polite"
    >
      <ConsoleLifecycleDetails state={state} />
      {isEnded ? (
        <Button size="sm" onClick={props.onRestart}>
          {t("remote.console.newSession")}
        </Button>
      ) : null}
      {canReconnect ? (
        <Button size="sm" variant="outline" onClick={props.onReconnect}>
          {t("remote.console.reconnect")}
        </Button>
      ) : null}
    </div>
  );
}
