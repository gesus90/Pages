import { useEffect, useRef, useState } from "react";

import {
  isTerminalAnswer,
  postTerminalCommand,
  readTerminalOpening,
  readTerminalPage,
  TerminalChannel,
} from "./terminal-client";

import type { Terminal } from "@xterm/xterm";
import type { TerminalSurface } from "@/app/components/agents/workspaces/remote/console/terminal-surface";
import type { AgentSessionKey } from "@/definition/AgentSessionJournal";
import type {
  AgentTerminalEvent,
  AgentTerminalSegment,
  AgentTerminalState,
} from "@/definition/AgentTerminal";

/** Lines an ordinary CLI keeps in the browser while older pages are loaded. */
const SCROLLBACK = 20_000;
/** Geometry changes of a typing viewer reach the server after this pause. */
const RESIZE_DELAY_MS = 300;

/** What the terminal of a console shows and offers. */
export interface PlanTerminal {
  readonly state: AgentTerminalState | null;
  readonly connection: "loading" | "live" | "reconnecting" | "closed";
  readonly error: string | null;
  readonly hasOlder: boolean;
  readonly isLoadingOlder: boolean;
  readonly isPending: boolean;
  /** The translated outcome of the last paste or interruption. */
  readonly notice: "pasted" | "interrupted" | null;
  loadOlder(): void;
  paste(text: string): Promise<boolean>;
  interrupt(): Promise<void>;
}

/** Whether the device is a phone or tablet without a hardware keyboard: the terminal is read-only there. */
export function isTouchDevice(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(hover: none) and (pointer: coarse)").matches
  );
}

/** Loads the browser terminal once the container is in the page. */
export function useTerminalSurface(
  container: React.RefObject<HTMLDivElement | null>,
  options: {
    readonly fitsContainer: boolean;
    readonly onCloseRequest: () => void;
  },
): TerminalSurface | null {
  const [surface, setSurface] = useState<TerminalSurface | null>(null);
  const { fitsContainer, onCloseRequest } = options;
  useEffect(() => {
    const element = container.current;
    if (!element) return undefined;
    let created: TerminalSurface | null = null;
    let isCancelled = false;
    void import("@/app/components/agents/workspaces/remote/console/terminal-surface")
      .then(({ createTerminalSurface }) =>
        createTerminalSurface(element, {
          isScreenReaderMode: false,
          onCloseRequest,
          fitsContainer,
          scrollback: SCROLLBACK,
        }),
      )
      .then((next) => {
        if (isCancelled) next.dispose();
        else {
          created = next;
          setSurface(next);
        }
      });
    return () => {
      isCancelled = true;
      created?.dispose();
    };
  }, [container, fitsContainer, onCloseRequest]);
  return surface;
}

/**
 * Rewrites the terminal with older segments in front and keeps the line the
 * viewer looked at in place, so the scroll position does not jump.
 */
function rebuild(
  terminal: Terminal,
  segments: readonly AgentTerminalSegment[],
): void {
  const buffer = terminal.buffer.active;
  const lengthBefore = buffer.length;
  const top = buffer.viewportY;
  terminal.reset();
  terminal.write(segments.map((segment) => segment.chunk).join(""), () => {
    const added = terminal.buffer.active.length - lengthBefore;
    terminal.scrollToLine(Math.max(0, top + added));
  });
}

/** Mutable parts of one terminal view that events and handlers share. */
interface TerminalRefs {
  segments: AgentTerminalSegment[];
  state: AgentTerminalState | null;
  channel: TerminalChannel | null;
}

function useTerminalCommands(key: AgentSessionKey): Pick<
  PlanTerminal,
  "isPending" | "notice" | "paste" | "interrupt"
> & {
  readonly commandError: string | null;
} {
  const [isPending, setPending] = useState(false);
  const [notice, setNotice] = useState<PlanTerminal["notice"]>(null);
  const [commandError, setCommandError] = useState<string | null>(null);
  async function run(
    fields:
      | { readonly intent: "paste"; readonly text: string }
      | { readonly intent: "interrupt" },
  ): Promise<boolean> {
    setPending(true);
    setNotice(null);
    const result = await postTerminalCommand(key, fields);
    setPending(false);
    setCommandError(result.ok ? null : result.error);
    if (result.ok)
      setNotice(fields.intent === "paste" ? "pasted" : "interrupted");
    return result.ok;
  }
  return {
    isPending,
    notice,
    commandError,
    paste: (text) => run({ intent: "paste", text }),
    interrupt: async () => {
      await run({ intent: "interrupt" });
    },
  };
}

/** What a connected terminal reports to its hook. */
interface ConnectionContext {
  readonly current: TerminalRefs;
  readonly isTypingDevice: boolean;
  readonly setState: (state: AgentTerminalState) => void;
  readonly setConnection: (connection: PlanTerminal["connection"]) => void;
  readonly setError: (error: string) => void;
  readonly setHasOlder: (hasOlder: boolean) => void;
}

/**
 * Opens the terminal of a node attempt in a browser terminal and follows it.
 *
 * @returns Ends the following and the input of this viewer.
 */
function connectTerminal(
  sessionKey: AgentSessionKey,
  terminal: Terminal,
  context: ConnectionContext,
): () => void {
  const { current, isTypingDevice } = context;
  const controller = new AbortController();
  let resizeTimer: ReturnType<typeof setTimeout> | undefined;
  function applyState(next: AgentTerminalState): void {
    current.state = next;
    context.setState(next);
    terminal.options.disableStdin = !(next.canInput && isTypingDevice);
    if (!isTypingDevice || !next.canInput)
      terminal.resize(next.columns, next.rows);
    if (next.status === "ended") current.channel?.end();
  }
  function receive(event: AgentTerminalEvent): void {
    if (event.kind === "output") {
      current.segments.push({ sequence: event.sequence, chunk: event.chunk });
      terminal.write(event.chunk);
    } else if (event.kind === "state") applyState(event.state);
    else {
      // Segments before the cursor are gone; older pages start after the gap.
      current.segments = [];
      context.setHasOlder(false);
    }
  }
  void readTerminalOpening(sessionKey, controller.signal).then((result) => {
    if (controller.signal.aborted) return;
    if (!result.ok) {
      context.setError(result.error);
      context.setConnection("closed");
      return;
    }
    const opening = result.value;
    applyState(opening.state);
    current.segments = [...opening.segments];
    if (opening.screen !== null) terminal.write(opening.screen);
    terminal.write(opening.segments.map((segment) => segment.chunk).join(""));
    context.setHasOlder(opening.hasOlder);
    const after = opening.segments.at(-1)?.sequence ?? opening.screenSequence;
    current.channel = new TerminalChannel(sessionKey, after, {
      onEvent: receive,
      onConnection: context.setConnection,
    });
    if (opening.state.status === "ended") current.channel.end();
  });
  const typed = terminal.onData((input) => {
    if (isTerminalAnswer(input) || !current.state?.canInput || !isTypingDevice)
      return;
    current.channel?.input(input);
  });
  const resized = terminal.onResize(({ cols, rows }) => {
    if (!isTypingDevice || !current.state?.canInput) return;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(
      () => current.channel?.resize(cols, rows),
      RESIZE_DELAY_MS,
    );
  });
  return () => {
    controller.abort();
    clearTimeout(resizeTimer);
    typed.dispose();
    resized.dispose();
    current.channel?.dispose();
    current.channel = null;
    current.segments = [];
  };
}

/**
 * Connects a browser terminal to the terminal of a node attempt.
 *
 * @remarks
 * Opening writes the current screen of a full-screen CLI, or the last share
 * of an ordinary one, then follows the live segments. Typed keys go to the
 * server only while it says this viewer may type; automatic answers of the
 * browser terminal to queries of the CLI are never sent. A viewer that may
 * type and fits the terminal to its window gives the pseudo terminal its
 * geometry; every other viewer shows the geometry the server reports.
 */
export function usePlanTerminal(
  key: AgentSessionKey,
  surface: TerminalSurface | null,
  options: { readonly isTypingDevice: boolean },
): PlanTerminal {
  const [state, setState] = useState<AgentTerminalState | null>(null);
  const [connection, setConnection] =
    useState<PlanTerminal["connection"]>("loading");
  const [error, setError] = useState<string | null>(null);
  const [hasOlder, setHasOlder] = useState(false);
  const [isLoadingOlder, setLoadingOlder] = useState(false);
  const refs = useRef<TerminalRefs>({
    segments: [],
    state: null,
    channel: null,
  });
  const commands = useTerminalCommands(key);
  const { isTypingDevice } = options;
  const runId = key.runId;
  const stepId = key.stepId;
  const planId = key.planId;
  const attemptId = key.attemptId;
  useEffect(() => {
    if (!surface) return undefined;
    return connectTerminal(
      { planId, runId, stepId, attemptId },
      surface.terminal,
      {
        current: refs.current,
        isTypingDevice,
        setState,
        setConnection,
        setError,
        setHasOlder,
      },
    );
  }, [surface, planId, runId, stepId, attemptId, isTypingDevice]);
  function loadOlder(): void {
    const current = refs.current;
    const first = current.segments[0];
    if (
      !surface ||
      !first ||
      isLoadingOlder ||
      current.state?.isAlternateScreen
    )
      return;
    setLoadingOlder(true);
    void readTerminalPage(key, first.sequence).then((result) => {
      setLoadingOlder(false);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      current.segments = [...result.value.segments, ...current.segments];
      setHasOlder(result.value.hasOlder);
      rebuild(surface.terminal, current.segments);
    });
  }
  return {
    state,
    connection,
    error: commands.commandError ?? error,
    hasOlder,
    isLoadingOlder,
    isPending: commands.isPending,
    notice: commands.notice,
    loadOlder,
    paste: commands.paste,
    interrupt: commands.interrupt,
  };
}
