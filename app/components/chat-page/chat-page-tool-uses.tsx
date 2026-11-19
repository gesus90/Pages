import { Ban, CircleStop, LoaderCircle, Terminal, Zap } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";
import { ScrollViewport } from "@/app/components/ui/scroll-viewport";
import { backendRequestHeaders } from "@/app/lib/backend-request";
import { cn } from "@/app/lib/cn";

import type {
  VirtualToolDetails,
  VirtualToolUse,
} from "@/definition/VirtualChat";

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
      <ScrollViewport
        as="pre"
        axis="both"
        isShell
        containerClassName="max-h-64 rounded-md bg-muted"
        className="px-2 py-1.5 font-mono text-xs whitespace-pre-wrap break-words text-foreground"
      >
        {text}
      </ScrollViewport>
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

/** The input, the result and the error of an opened call, read on demand where the history left them out. */
function ToolDetailsBody({
  use,
  isLoading,
  hasFailed,
}: {
  readonly use: VirtualToolUse;
  readonly isLoading: boolean;
  readonly hasFailed: boolean;
}): React.ReactElement {
  const { t } = useTranslation();
  const hasText =
    (use.input ?? "") !== "" || (use.output ?? "") !== "" || use.detail !== "";
  if (hasText)
    return (
      <div className="flex flex-col gap-2 px-2 pb-2">
        <ToolText label={t("chatPage.toolInput")} text={use.input} />
        <ToolText label={t("chatPage.toolOutput")} text={use.output} />
        <ToolText label={t("chatPage.toolError")} text={use.detail} />
      </div>
    );
  let message = t("chatPage.toolNoDetails");
  if (isLoading) message = t("chatPage.toolDetailsLoading");
  else if (hasFailed) message = t("chatPage.toolDetailsFailed");
  return (
    <p
      className="px-2 pb-2 text-muted-foreground"
      role={isLoading ? "status" : undefined}
    >
      {message}
    </p>
  );
}

/**
 * One tool call of an agent in one line of 28 px: the tool or
 * command with its short description and, at the right, its duration and a
 * cancel button while it runs; opened, its input and result, which a call of
 * a stored answer reads when it opens.
 */
export function ChatPageToolUse({
  use: storedUse,
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
  const details = useToolDetails(storedUse);
  const { use } = details;
  const status = t(`chatPage.toolStatus.${use.status ?? "completed"}`);
  const duration = durationText(use, durationLabel);
  return (
    <li
      className={cn(
        "min-w-0 shrink-0 text-xs text-foreground",
        !isRow && "rounded-lg bg-surface shadow-xs",
      )}
      data-tool-use={use.callId}
    >
      <details className="group" onToggle={details.onToggle}>
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
        <ToolDetailsBody
          use={use}
          isLoading={details.isLoading}
          hasFailed={details.hasFailed}
        />
      </details>
    </li>
  );
}

type DetailsState =
  | { readonly status: "loading"; readonly url: string }
  | { readonly status: "failed"; readonly url: string }
  | {
      readonly status: "loaded";
      readonly url: string;
      readonly details: VirtualToolDetails;
    };

interface ToolDetails {
  readonly use: VirtualToolUse;
  readonly isLoading: boolean;
  readonly hasFailed: boolean;
  onToggle(event: React.SyntheticEvent<HTMLDetailsElement>): void;
}

function isToolDetails(value: unknown): value is VirtualToolDetails {
  return (
    typeof value === "object" &&
    value !== null &&
    "detail" in value &&
    typeof value.detail === "string" &&
    (!("input" in value) || typeof value.input === "string") &&
    (!("output" in value) || typeof value.output === "string")
  );
}

async function readToolDetails(url: string): Promise<VirtualToolDetails> {
  const response = await fetch(url, {
    cache: "no-store",
    headers: backendRequestHeaders({ Accept: "application/json" }),
  });
  if (!response.ok) throw new Error("Tool call details unavailable.");
  const payload: unknown = await response.json();
  if (!isToolDetails(payload)) throw new Error("Tool call details invalid.");
  return payload;
}

function useToolDetails(use: VirtualToolUse): ToolDetails {
  const [state, setState] = useState<DetailsState | null>(null);
  const url = use.detailsUrl;
  const own = url !== undefined && state?.url === url ? state : null;

  async function load(target: string): Promise<void> {
    setState({ status: "loading", url: target });
    try {
      const details = await readToolDetails(target);
      setState({ status: "loaded", url: target, details });
    } catch (error: unknown) {
      // The person can open the call again to retry.
      console.warn("Tool call details could not be read.", error);
      setState({ status: "failed", url: target });
    }
  }

  function onToggle(event: React.SyntheticEvent<HTMLDetailsElement>): void {
    if (!event.currentTarget.open || url === undefined) return;
    if (own?.status === "loading" || own?.status === "loaded") return;
    void load(url);
  }

  const details = own?.status === "loaded" ? own.details : null;
  return {
    use: details
      ? {
          ...use,
          ...(details.input === undefined ? {} : { input: details.input }),
          ...(details.output === undefined ? {} : { output: details.output }),
          detail: details.detail === "" ? use.detail : details.detail,
        }
      : use,
    // Until a reading answers, a call with left out details shows them as on their way.
    isLoading: url !== undefined && (own === null || own.status === "loading"),
    hasFailed: own?.status === "failed",
    onToggle,
  };
}
