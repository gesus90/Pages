import { Ban, CircleStop, LoaderCircle, Terminal, Zap } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";
import { cn } from "@/app/lib/cn";

import type { VirtualToolUse } from "@/definition/VirtualChat";

/** A preformatted block of the input or the result of a call. */
function ToolText({
  label,
  text,
}: {
  readonly label: string;
  readonly text: string | undefined;
}): React.ReactElement | null {
  if (text === undefined || text === "") return null;
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[11px] font-semibold text-muted-foreground uppercase">
        {label}
      </span>
      <pre className="max-h-64 overflow-auto rounded-md bg-muted px-2 py-1.5 font-mono text-xs whitespace-pre-wrap break-words text-foreground">
        {text}
      </pre>
    </div>
  );
}

function StatusIcon({
  use,
}: {
  readonly use: VirtualToolUse;
}): React.ReactElement {
  if (use.status === "running")
    return (
      <LoaderCircle
        aria-hidden="true"
        className="size-3.5 animate-spin text-primary"
      />
    );
  if (use.status === "cancelled")
    return (
      <Ban aria-hidden="true" className="size-3.5 text-muted-foreground" />
    );
  const Icon = use.isNative === true ? Terminal : Zap;
  return (
    <Icon
      aria-hidden="true"
      className={
        use.status === "failed"
          ? "size-3.5 text-destructive"
          : "size-3.5 text-primary"
      }
    />
  );
}

/** The duration of a call as the tool line shows it: milliseconds or seconds. */
export function formatToolDuration(durationMs: number): string {
  if (durationMs < 1_000) return `${durationMs} ms`;
  const seconds = durationMs / 1_000;
  return seconds < 60
    ? `${seconds.toFixed(1)} s`
    : `${Math.floor(seconds / 60)} min ${Math.round(seconds % 60)} s`;
}

/** How long a call ran: the given label, else its stored duration. */
function durationText(
  use: VirtualToolUse,
  durationLabel: string | undefined,
): string | undefined {
  if (durationLabel !== undefined) return durationLabel;
  return use.durationMs === undefined
    ? undefined
    : formatToolDuration(use.durationMs);
}

/**
 * One tool call of an agent in one line of 28 px: the tool or
 * command with its short description and, at the right, its duration and a
 * cancel button while it runs; opened, its input and result.
 */
export function ChatPageToolUse({
  use,
  onCancel,
  durationLabel,
  isRow = false,
}: {
  readonly use: VirtualToolUse;
  /** Cancels the running call; absent for a call of a stored answer. */
  readonly onCancel?: () => void;
  /** How long the call ran, such as "1,2 s"; the stored duration otherwise. */
  readonly durationLabel?: string;
  /** A line of a list on one surface rather than a card of its own. */
  readonly isRow?: boolean;
}): React.ReactElement {
  const { t } = useTranslation();
  const status = t(`chatPage.toolStatus.${use.status ?? "completed"}`);
  const duration = durationText(use, durationLabel);
  const hasDetails =
    (use.input ?? "") !== "" || (use.output ?? "") !== "" || use.detail !== "";
  return (
    <li
      className={cn(
        "min-w-0 shrink-0 text-xs text-foreground",
        !isRow && "rounded-lg bg-surface shadow-xs",
      )}
      data-tool-use={use.callId}
    >
      <details className="group">
        <summary className="flex h-7 min-w-0 cursor-pointer items-center gap-1.5 overflow-hidden px-2 font-mono whitespace-nowrap">
          <StatusIcon use={use} />
          <span className="min-w-0 shrink truncate">{use.name}</span>
          {use.summary ? (
            <span className="min-w-0 flex-1 truncate font-sans text-muted-foreground">
              {use.summary}
            </span>
          ) : null}
          <span className="sr-only">{status}</span>
          {duration === undefined ? null : (
            <span className="ml-auto shrink-0 pl-1 text-muted-foreground tabular-nums">
              {duration}
            </span>
          )}
          {use.status === "running" && onCancel ? (
            <Button
              className={cn(
                "h-6 shrink-0 px-2 text-xs",
                duration === undefined && "ml-auto",
              )}
              onClick={(event) => {
                event.preventDefault();
                onCancel();
              }}
              size="sm"
              type="button"
              variant="outline"
            >
              <CircleStop aria-hidden="true" className="size-3" />
              {t("chatPage.cancelTool")}
            </Button>
          ) : null}
        </summary>
        {hasDetails ? (
          <div className="flex flex-col gap-2 px-2 pb-2">
            <ToolText label={t("chatPage.toolInput")} text={use.input} />
            <ToolText label={t("chatPage.toolOutput")} text={use.output} />
            <ToolText label={t("chatPage.toolError")} text={use.detail} />
          </div>
        ) : (
          <p className="px-2 pb-2 text-muted-foreground">
            {t("chatPage.toolNoDetails")}
          </p>
        )}
      </details>
    </li>
  );
}
