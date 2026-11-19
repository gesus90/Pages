import { ChevronRight, LoaderCircle, Wrench } from "lucide-react";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";

import { ScrollViewport } from "@/app/components/ui/scroll-viewport";
import { cn } from "@/app/lib/cn";

import { ChatPageToolUse } from "./chat-page-tool-uses";
import { formatSeconds } from "./live/live-answer-state";

import type { VirtualToolUse } from "@/definition/VirtualChat";

interface ChatPageToolStripProps {
  /** The calls of the running answer, oldest first. */
  readonly uses: readonly VirtualToolUse[];
  /** How long the calls run so far, such as "12 s"; absent where unknown. */
  readonly durationLabel?: string;
  /** The duration a call shows at the right, such as "1,2 s". */
  readonly durationOf?: (use: VirtualToolUse) => string | undefined;
  /** Cancels the running calls; absent where nobody may. */
  readonly onCancel?: () => void;
}

/** The call the folded line names: the newest running one, else the newest. */
function currentUse(
  uses: readonly VirtualToolUse[],
): { readonly use: VirtualToolUse; readonly isRunning: boolean } | null {
  const running = uses.findLast((use) => use.status === "running");
  if (running) return { use: running, isRunning: true };
  const last = uses.at(-1);
  return last ? { use: last, isRunning: false } : null;
}

/**
 * The tool calls of a running answer in one line of 32 px: "16
 * Werkzeuge · läuft: Read", the running time and an arrow; opened, one line
 * of 28 px per call below it, at most six visible before the list scrolls.
 * @remarks
 * The spinner and the wrench share one place of 14 px, and the time has a
 * minimum width with figures of equal width, so neither a change of the
 * symbol nor of the time moves anything in the line.
 * Whether the list is open stays as it is while new calls arrive. A click on
 * a call shows its input and result.
 */
export function ChatPageToolStrip({
  uses,
  durationLabel,
  durationOf,
  onCancel,
}: ChatPageToolStripProps): React.ReactElement | null {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const listId = useId();
  const current = currentUse(uses);
  if (!current) return null;
  return (
    <section
      aria-label={t("chatPage.liveTools")}
      className="flex w-full min-w-0 flex-col gap-1"
      data-tool-strip=""
    >
      <button
        type="button"
        aria-controls={listId}
        aria-expanded={isOpen}
        className="flex h-8 w-full min-w-0 items-center gap-2 overflow-hidden rounded-lg border border-border bg-surface px-2.5 text-xs whitespace-nowrap text-foreground hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        data-tool-strip-head=""
        onClick={() => setIsOpen((open) => !open)}
      >
        <span
          aria-hidden="true"
          className="inline-flex size-3.5 shrink-0 items-center justify-center"
          data-tool-strip-icon=""
        >
          {current.isRunning ? (
            <LoaderCircle className="size-3.5 animate-spin text-primary" />
          ) : (
            <Wrench className="size-3.5 text-muted-foreground" />
          )}
        </span>
        <span className="shrink-0 font-semibold">
          {t("chatPage.liveAnswer.tools", { count: uses.length })}
        </span>
        <span className="min-w-0 truncate font-mono text-muted-foreground">
          {t(
            current.isRunning
              ? "chatPage.liveAnswer.toolRunning"
              : "chatPage.liveAnswer.toolLast",
            { tool: current.use.name },
          )}
        </span>
        <span
          className="ml-auto min-w-16 shrink-0 text-right text-muted-foreground tabular-nums"
          data-elapsed=""
        >
          {durationLabel}
        </span>
        <ChevronRight
          aria-hidden="true"
          className={cn(
            "size-3.5 shrink-0 text-muted-foreground transition-transform",
            isOpen && "rotate-90",
          )}
        />
      </button>
      <ScrollViewport
        as="ul"
        axis="vertical"
        id={listId}
        hidden={!isOpen}
        isShell
        containerClassName={cn(
          "max-h-[168px] rounded-lg bg-surface ring-1 ring-border",
          !isOpen && "hidden",
        )}
        className="flex min-w-0 flex-col"
        data-tool-strip-list=""
      >
        {uses.map((use, index) => (
          <ChatPageToolUse
            key={use.callId ?? `${use.name}:${String(index)}`}
            use={use}
            durationLabel={durationOf?.(use)}
            isRow
            onCancel={onCancel}
          />
        ))}
      </ScrollViewport>
    </section>
  );
}

/** The time the calls ran together, where the page knows their durations. */
function summedDuration(tools: readonly VirtualToolUse[]): number | undefined {
  const timed = tools.filter((use) => use.durationMs !== undefined);
  if (timed.length === 0) return undefined;
  return timed.reduce((sum, use) => sum + (use.durationMs ?? 0), 0);
}

/**
 * The tool calls of the answer an agent is working on now, below
 * the history: one folded line that opens the list of calls.
 */
export function ChatPageLiveTools({
  tools,
  onCancel,
}: {
  readonly tools: readonly VirtualToolUse[];
  readonly onCancel: () => void;
}): React.ReactElement | null {
  const { i18n } = useTranslation();
  if (tools.length === 0) return null;
  const total = summedDuration(tools);
  return (
    <div className="flex shrink-0 px-4" data-live-tools="">
      <ChatPageToolStrip
        uses={tools}
        durationLabel={
          total === undefined ? undefined : formatSeconds(total, i18n.language)
        }
        durationOf={(use) =>
          use.durationMs === undefined
            ? undefined
            : formatSeconds(use.durationMs, i18n.language)
        }
        onCancel={onCancel}
      />
    </div>
  );
}
