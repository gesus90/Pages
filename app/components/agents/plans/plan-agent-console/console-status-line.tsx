import { useTranslation } from "react-i18next";

import { useNow } from "./use-terminal-surface";

import type { TerminalRunningTool } from "./terminal-lines";

interface ConsoleStatusLineProps {
  /** The newest call without a result; `null` when none runs. */
  readonly tool: TerminalRunningTool | null;
  /** When a planned resume starts; `null` when none waits. */
  readonly resumeAt: string | null;
}

function secondsBetween(from: number, to: number): number {
  return Math.max(0, Math.round((to - from) / 1000));
}

/** Text left and counter right: the resume countdown, the running call, or that the agent works. */
function statusParts(
  props: ConsoleStatusLineProps,
  now: number,
  t: ReturnType<typeof useTranslation>["t"],
): {
  readonly name: string;
  readonly detail: string;
  readonly counter: string | null;
} {
  const key = "plans.console.terminal";
  const resumeAt = Date.parse(props.resumeAt ?? "");
  if (Number.isFinite(resumeAt))
    return {
      name: t(`${key}.status.resume`),
      detail: "",
      counter: t(`${key}.status.resumeIn`, {
        seconds: secondsBetween(now, resumeAt),
      }),
    };
  const { tool } = props;
  if (!tool)
    return { name: t(`${key}.status.working`), detail: "", counter: null };
  return {
    name: tool.name,
    detail: tool.detail,
    counter:
      tool.startedAt === null
        ? null
        : t(`${key}.running`, { seconds: secondsBetween(tool.startedAt, now) }),
  };
}

/**
 * The fixed status line between the Pages terminal and its input (PAGE-289).
 *
 * @remarks
 * It is the only part of the terminal that changes with the time: the
 * running call with its seconds, the countdown of a planned resume, or that
 * the agent works. The terminal text itself never depends on the time, so it
 * only grows while the session runs. The caller keeps the line for the whole
 * session, so the height of the terminal stays the same.
 */
export function ConsoleStatusLine(
  props: ConsoleStatusLineProps,
): React.ReactElement {
  const { t } = useTranslation();
  const isTicking = props.resumeAt !== null || props.tool?.startedAt != null;
  const now = useNow(isTicking);
  const status = statusParts(props, now, t);
  return (
    <div
      data-testid="plan-terminal-status"
      className="mx-[22px] flex min-w-0 items-center gap-2 border-t border-agent-terminal-rule py-1.5 font-mono text-[13px] leading-[1.6]"
    >
      <span
        aria-hidden="true"
        className="size-2 shrink-0 rounded-full bg-agent-terminal-accent"
      />
      <span className="shrink-0 font-semibold text-agent-terminal-foreground">
        {status.name}
      </span>
      <span
        className="min-w-0 flex-1 truncate text-agent-terminal-muted"
        title={status.detail || undefined}
      >
        {status.detail}
      </span>
      {status.counter === null ? null : (
        <span className="shrink-0 text-agent-terminal-muted tabular-nums">
          {status.counter}
        </span>
      )}
    </div>
  );
}
