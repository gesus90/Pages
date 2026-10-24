import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";
import { cn } from "@/app/lib/cn";
import { CONSOLE_MAXIMUM_RETRIES } from "@/definition/RemoteConsole";

import type { RemoteConsoleState } from "@/definition/RemoteConsole";
import type { ConsoleView } from "./console-view";

type StatusTone = "neutral" | "success" | "warning" | "danger";

const STATUS_TONES: Record<ConsoleView, StatusTone> = {
  connecting: "neutral",
  connected: "success",
  reconnecting: "warning",
  lost: "danger",
  exited: "neutral",
  authFailed: "danger",
  hostKeyChanged: "danger",
  unreachable: "danger",
  ptyUnavailable: "danger",
  accessRevoked: "danger",
  failed: "danger",
};
const TONE_TEXT: Record<StatusTone, string> = {
  neutral: "text-muted-foreground",
  success: "text-success",
  warning: "text-warning",
  danger: "text-destructive",
};
const TONE_DOT: Record<StatusTone, string> = {
  neutral: "bg-muted-foreground",
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-destructive",
};

/** Compact lifecycle label in the console header. */
export function ConsoleConnectionStatus(props: {
  readonly state: RemoteConsoleState;
  readonly view: ConsoleView;
}): React.ReactElement {
  const { t } = useTranslation();
  const tone = STATUS_TONES[props.view];
  return (
    <span
      role="status"
      aria-live="polite"
      className={cn("flex items-center gap-2 text-xs", TONE_TEXT[tone])}
    >
      <span
        aria-hidden="true"
        className={cn("size-1.5 rounded-full", TONE_DOT[tone])}
      />
      {t(`remote.console.status.${props.view}`, {
        attempt: Math.max(1, props.state.attempts),
        maximum: CONSOLE_MAXIMUM_RETRIES,
      })}
    </span>
  );
}

/** A setup that stopped keeps its scrollback; it is never resumed, only started anew. */
function useSetupBannerText(
  view: ConsoleView,
  state: RemoteConsoleState,
): string | null {
  const { t } = useTranslation();
  if (view === "lost") return t("remote.setup.banner.lost");
  if (view === "exited")
    return t("remote.setup.banner.exited", { code: state.exitCode ?? "—" });
  return null;
}

/** The banner text of a view that keeps the scrollback visible. */
function useBannerText(
  view: ConsoleView,
  state: RemoteConsoleState,
): string | null {
  const { t } = useTranslation();
  if (view === "reconnecting") return t("remote.console.banner.reconnecting");
  if (view === "lost" && state.message === "remote.console.sessionLost")
    return t("remote.console.banner.sessionLost");
  if (view === "lost")
    return t("remote.console.banner.lost", { count: state.attempts });
  if (view === "exited")
    return t("remote.console.banner.exited", { code: state.exitCode ?? "—" });
  return null;
}

/** Interruptions and the end of the shell, above the scrollback that stays readable. */
export function ConsoleBanner(props: {
  readonly state: RemoteConsoleState;
  readonly view: ConsoleView;
  readonly isSetup: boolean;
  readonly onRestart: () => void;
}): React.ReactElement | null {
  const { t } = useTranslation();
  const shellText = useBannerText(props.view, props.state);
  const setupText = useSetupBannerText(props.view, props.state);
  const text = props.isSetup ? setupText : shellText;
  if (text === null) return null;
  const isConfirmed = props.state.setup?.outcome === "confirmed";
  return (
    <div
      className="flex shrink-0 flex-wrap items-center justify-between gap-3 bg-warning-subtle px-6 py-3 text-[13px] leading-5 text-warning"
      role="status"
      aria-live="polite"
    >
      <p>{text}</p>
      {props.view === "reconnecting" || isConfirmed ? null : (
        <Button variant="outline" onClick={props.onRestart}>
          {t(
            props.isSetup
              ? "remote.setup.restart"
              : "remote.console.newSession",
          )}
        </Button>
      )}
    </div>
  );
}
