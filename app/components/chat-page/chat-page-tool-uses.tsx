import { CircleStop, LoaderCircle, Terminal, Zap } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";

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

/**
 * One tool call of an agent (PAGE-303): the tool or command in the summary,
 * input and result when opened, and a cancel button while it runs.
 */
export function ChatPageToolUse({
  use,
  onCancel,
}: {
  readonly use: VirtualToolUse;
  /** Cancels the running call; absent for a call of a stored answer. */
  readonly onCancel?: () => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const status = t(`chatPage.toolStatus.${use.status ?? "completed"}`);
  const hasDetails =
    (use.input ?? "") !== "" || (use.output ?? "") !== "" || use.detail !== "";
  return (
    <li className="min-w-0 rounded-lg bg-surface text-xs text-foreground shadow-xs">
      <details className="group">
        <summary className="flex cursor-pointer items-center gap-1.5 px-2 py-1 font-mono">
          <StatusIcon use={use} />
          <span className="min-w-0 truncate">{use.name}</span>
          <span className="sr-only">{status}</span>
          {use.status === "running" && onCancel ? (
            <Button
              className="ml-auto h-6 px-2 text-xs"
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

/** The tool calls of the answer an agent is working on now (PAGE-303). */
export function ChatPageLiveTools({
  tools,
  onCancel,
}: {
  readonly tools: readonly VirtualToolUse[];
  readonly onCancel: () => void;
}): React.ReactElement | null {
  const { t } = useTranslation();
  if (tools.length === 0) return null;
  return (
    <section
      aria-label={t("chatPage.liveTools")}
      className="flex shrink-0 flex-col gap-1.5"
    >
      <h3 className="text-[13px] font-semibold text-muted-foreground">
        {t("chatPage.liveTools")}
      </h3>
      <ul className="flex max-h-72 flex-col gap-1.5 overflow-auto">
        {tools.map((use) => (
          <ChatPageToolUse
            key={use.callId ?? use.name}
            use={use}
            onCancel={onCancel}
          />
        ))}
      </ul>
    </section>
  );
}
