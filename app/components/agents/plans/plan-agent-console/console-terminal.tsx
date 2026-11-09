import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";

import { ConsoleTerminalInput } from "./console-terminal-input";
import {
  isTouchDevice,
  usePlanTerminal,
  useTerminalSurface,
} from "./use-plan-terminal";

import type { AgentSessionKey } from "@/definition/AgentSessionJournal";
import type { AgentTerminalState } from "@/definition/AgentTerminal";
import type { PlanTerminal } from "./use-plan-terminal";

interface ConsoleTerminalProps {
  readonly sessionKey: AgentSessionKey;
  /** Names a node of the plan, for the member whose turn runs in a shared terminal. */
  readonly nodeName: (stepId: string) => string;
  readonly onCloseRequest: () => void;
  /** Reports the state to the session facts beside the terminal. */
  readonly onState: (state: AgentTerminalState | null) => void;
}

/** What the line above the terminal says: connection, input right and the active member. */
function TerminalStatus({
  terminal,
  nodeName,
  isTouch,
  canLoadOlder,
}: {
  readonly terminal: PlanTerminal;
  readonly nodeName: (stepId: string) => string;
  readonly isTouch: boolean;
  /** Older segments of an ordinary CLI can be loaded; the button sits in this line so nothing moves when it goes. */
  readonly canLoadOlder: boolean;
}): React.ReactElement {
  const { t } = useTranslation();
  const { state } = terminal;
  const typing = isTouch ? "touch" : "typing";
  const access = state?.canInput ? typing : "readOnly";
  return (
    <div
      role="status"
      className="flex flex-wrap items-center gap-2 px-4 py-2 text-xs text-muted-foreground"
    >
      <span>
        {t(
          `plans.console.terminal.connection.${state?.status === "ended" ? "ended" : terminal.connection}`,
        )}
      </span>
      <span aria-hidden="true">·</span>
      <span>{t(`plans.console.terminal.access.${access}`)}</span>
      {state?.activeStepId ? (
        <span className="rounded-md bg-info-subtle px-2 py-0.5 font-medium text-info">
          {t("plans.console.terminal.activeMember", {
            name: nodeName(state.activeStepId),
          })}
        </span>
      ) : null}
      {canLoadOlder ? (
        <Button
          size="sm"
          variant="ghost"
          className="h-6 px-2 text-xs"
          disabled={terminal.isLoadingOlder}
          onClick={terminal.loadOlder}
        >
          {t(
            terminal.isLoadingOlder
              ? "plans.console.terminal.olderLoading"
              : "plans.console.terminal.older",
          )}
        </Button>
      ) : null}
      {terminal.error ? (
        <span role="alert" className="text-destructive">
          {t([
            `settings.agents.error.${terminal.error}`,
            "settings.agents.error.general",
          ])}
        </span>
      ) : null}
    </div>
  );
}

/**
 * The CLI of a node in its terminal, as it runs on the server.
 *
 * @remarks
 * Whoever may run the plan types directly into the CLI, its own commands
 * included; everyone else, and every phone, only sees it. Closing the
 * console ends the view, never the CLI or the run. A CLI with ordinary
 * output loads older segments when the viewer reaches the top; a full-screen
 * CLI scrolls only with its own keys.
 */
export function ConsoleTerminal(
  props: ConsoleTerminalProps,
): React.ReactElement {
  const { t } = useTranslation();
  const container = useRef<HTMLDivElement | null>(null);
  const [isTouch] = useState(isTouchDevice);
  const { onCloseRequest, onState } = props;
  // The terminal is created once; it calls the newest close handler.
  const latestClose = useRef(onCloseRequest);
  useEffect(() => {
    latestClose.current = onCloseRequest;
  }, [onCloseRequest]);
  const closeRequest = useCallback(() => latestClose.current(), []);
  const surface = useTerminalSurface(container, {
    fitsContainer: !isTouch,
    onCloseRequest: closeRequest,
  });
  const terminal = usePlanTerminal(props.sessionKey, surface, {
    isTypingDevice: !isTouch,
  });
  const { loadOlder, hasOlder } = terminal;
  useEffect(() => {
    if (!surface) return undefined;
    const scroll = surface.terminal.onScroll((line) => {
      if (line === 0 && hasOlder) loadOlder();
    });
    return () => scroll.dispose();
  }, [surface, hasOlder, loadOlder]);
  const { state } = terminal;
  useEffect(() => {
    onState(state);
  }, [state, onState]);
  const isAlternate = terminal.state?.isAlternateScreen === true;
  const canIntervene = terminal.state?.canInput === true;
  return (
    <section
      aria-label={t("plans.console.terminal.title")}
      className="flex min-h-[32rem] flex-1 flex-col lg:min-h-0"
    >
      <TerminalStatus
        terminal={terminal}
        canLoadOlder={hasOlder && !isAlternate}
        nodeName={props.nodeName}
        isTouch={isTouch}
      />
      {terminal.state?.question ? (
        <p
          role="alert"
          className="mx-4 mb-2 rounded-md bg-destructive-subtle px-3 py-2 text-xs text-destructive"
        >
          {t("plans.console.terminal.question", {
            question: terminal.state.question,
          })}
        </p>
      ) : null}
      <div className="min-h-0 flex-1 overflow-auto bg-terminal-surface px-2 py-1">
        <div
          ref={container}
          data-testid="plan-terminal"
          className="h-full min-h-64 w-full"
        />
      </div>
      {canIntervene ? <ConsoleTerminalInput terminal={terminal} /> : null}
    </section>
  );
}
