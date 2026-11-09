import { useCallback, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";

import { ConsoleTerminalInput } from "./console-terminal-input";
import {
  currentEnding,
  earlierAttempts,
  hasSessionEnded,
} from "./console-step-state";
import { renderTerminal } from "./terminal-lines";
import { terminalTexts } from "./terminal-texts";
import { useNow, useTerminalSurface } from "./use-terminal-surface";
import { useTerminalHistory } from "./use-terminal-history";

import type { TerminalSurface } from "@/app/components/agents/workspaces/remote/console/terminal-surface";
import type { AgentPlanStepResult } from "@/definition/AgentPlan";
import type {
  AgentSessionEvent,
  AgentSessionKey,
} from "@/definition/AgentSessionJournal";
import type { TerminalAttempt } from "./terminal-lines";
import type { AgentSessionData } from "./use-agent-session";
import type { SessionCommands } from "./use-session-commands";
import type { TerminalHistory } from "./use-terminal-history";

/** What the bottom of the terminal offers. */
export type TerminalInputMode = "line" | "ended" | "none";

interface ConsoleTerminalProps {
  readonly sessionKey: AgentSessionKey;
  readonly step: AgentPlanStepResult;
  readonly session: AgentSessionData;
  readonly commands: SessionCommands;
  readonly provider: string;
  readonly model: string;
  /** The instruction of the node, as the plan prompt of the first attempt. */
  readonly prompt: string | null;
  readonly inputMode: TerminalInputMode;
  readonly canInterrupt: boolean;
  readonly onCloseRequest: () => void;
}

function joined(
  older: readonly AgentSessionEvent[],
  live: readonly AgentSessionEvent[],
): readonly AgentSessionEvent[] {
  const unique = new Map(older.map((event) => [event.sequence, event]));
  for (const event of live) unique.set(event.sequence, event);
  return [...unique.values()].sort(
    (left, right) => left.sequence - right.sequence,
  );
}

/** The attempts of the node in order, the current one last. */
function terminalAttempts(
  props: Pick<ConsoleTerminalProps, "sessionKey" | "step" | "session">,
  history: TerminalHistory,
  now: number,
): readonly TerminalAttempt[] {
  const earlier = earlierAttempts(props.step, props.sessionKey.attemptId);
  const index = (props.step.session?.retry?.attempts ?? []).findIndex(
    (attempt) => attempt.attemptId === props.sessionKey.attemptId,
  );
  return [
    ...earlier.map((attempt) => {
      const events = history.earlier.get(attempt.attemptId) ?? [];
      return {
        number: attempt.number,
        startedAt: events[0]?.createdAt ?? null,
        events,
        ending: attempt.ending,
      };
    }),
    {
      number: index >= 0 ? index + 1 : earlier.length + 1,
      startedAt: props.step.session?.startedAt ?? null,
      events: joined(history.older, props.session.events),
      ending: currentEnding(props.step, now),
    },
  ];
}

/**
 * Writes the text into xterm: only what was added when the text grew, all of
 * it after another change, keeping the line the reader looks at in place.
 */
function useTerminalText(surface: TerminalSurface | null, text: string): void {
  const written = useRef("");
  useEffect(() => {
    if (!surface) return;
    const { terminal } = surface;
    if (text.startsWith(written.current)) {
      terminal.write(text.slice(written.current.length));
      written.current = text;
      return;
    }
    const buffer = terminal.buffer.active;
    const lengthBefore = buffer.length;
    const top = buffer.viewportY;
    const isAtBottom = buffer.viewportY >= buffer.baseY;
    terminal.reset();
    terminal.write(`\u001b[?25l${text}`, () => {
      if (isAtBottom) terminal.scrollToBottom();
      else
        terminal.scrollToLine(
          Math.max(0, top + terminal.buffer.active.length - lengthBefore),
        );
    });
    written.current = text;
  }, [surface, text]);
}

/** Reads older history once the reader reaches the top, by scrolling or by the wheel at the top. */
function useLoadOlderAtTop(
  surface: TerminalSurface | null,
  container: React.RefObject<HTMLDivElement | null>,
  history: TerminalHistory,
): void {
  const { hasOlder, loadOlder } = history;
  useEffect(() => {
    if (!surface || !hasOlder) return undefined;
    const scroll = surface.terminal.onScroll((line) => {
      if (line === 0) loadOlder();
    });
    const element = container.current;
    function handleWheel(event: WheelEvent): void {
      if (event.deltaY < 0 && surface?.terminal.buffer.active.viewportY === 0)
        loadOlder();
    }
    element?.addEventListener("wheel", handleWheel, { passive: true });
    return () => {
      scroll.dispose();
      element?.removeEventListener("wheel", handleWheel);
    };
  }, [surface, container, hasOlder, loadOlder]);
}

function TerminalFooter(props: {
  readonly inputMode: TerminalInputMode;
  readonly commands: SessionCommands;
  readonly canInterrupt: boolean;
}): React.ReactElement | null {
  const { t } = useTranslation();
  if (props.inputMode === "line")
    return (
      <ConsoleTerminalInput
        commands={props.commands}
        canInterrupt={props.canInterrupt}
      />
    );
  if (props.inputMode === "ended")
    return (
      <p className="px-[22px] pt-2 pb-3 font-mono text-xs text-agent-terminal-muted">
        {t("plans.console.terminal.ended")}
      </p>
    );
  return null;
}

/**
 * The Pages terminal of an agent node: the stored ACP history of all its
 * attempts in one xterm, the same for every provider (PAGE-284).
 *
 * @remarks
 * It is no PTY and no surface of a CLI. The lines come from
 * {@link renderTerminal}; the newest events arrive live, older ones load
 * when the reader scrolls up. Closing the console ends only the view.
 */
export function ConsoleTerminal(
  props: ConsoleTerminalProps,
): React.ReactElement {
  const { t } = useTranslation();
  const container = useRef<HTMLDivElement | null>(null);
  const { onCloseRequest } = props;
  // The terminal is created once; it calls the newest close handler.
  const latestClose = useRef(onCloseRequest);
  useEffect(() => {
    latestClose.current = onCloseRequest;
  }, [onCloseRequest]);
  const closeRequest = useCallback(() => latestClose.current(), []);
  const surface = useTerminalSurface(container, closeRequest);
  const now = useNow(!hasSessionEnded(props.step));
  const history = useTerminalHistory(props.sessionKey, {
    firstSequence: props.session.events[0]?.sequence ?? null,
    hasEarlier: props.session.hasEarlier,
    earlier: earlierAttempts(props.step, props.sessionKey.attemptId),
  });
  const todoTexts = new Map(
    (props.step.session?.contract?.todos ?? []).map((todo) => [
      todo.id,
      todo.text,
    ]),
  );
  const text = renderTerminal({
    provider: props.provider,
    model: props.model,
    prompt: props.prompt,
    attempts: terminalAttempts(props, history, now),
    todoTexts,
    now,
    texts: terminalTexts(t),
  });
  useTerminalText(surface, text);
  useLoadOlderAtTop(surface, container, history);
  return (
    <section
      aria-label={t("plans.console.terminal.title")}
      className="flex min-h-[24rem] min-w-0 flex-1 flex-col bg-agent-terminal-surface min-[680px]:min-h-0"
    >
      <div className="min-h-0 flex-1 px-[22px] pt-[18px] pb-2">
        <div
          ref={container}
          data-testid="plan-terminal"
          className="h-full w-full"
        />
      </div>
      <TerminalFooter
        inputMode={props.inputMode}
        commands={props.commands}
        canInterrupt={props.canInterrupt}
      />
    </section>
  );
}
