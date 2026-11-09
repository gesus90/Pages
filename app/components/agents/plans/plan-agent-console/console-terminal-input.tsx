import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import type { SessionCommands } from "./use-session-commands";

/** Rows the input grows to before it scrolls. */
const MAXIMUM_ROWS = 8;
/** The longest instruction the route takes. */
const MAXIMUM_INSTRUCTION = 20_000;

interface ConsoleTerminalInputProps {
  readonly commands: SessionCommands;
  /** A turn runs that Strg+C and Escape can interrupt. */
  readonly canInterrupt: boolean;
}

/** The own inputs of this console, for arrow up and down. */
function useInputHistory(): {
  readonly remember: (text: string) => void;
  readonly step: (direction: -1 | 1) => string | null;
} {
  const entries = useRef<string[]>([]);
  const position = useRef(0);
  return {
    remember: (text) => {
      entries.current = [...entries.current, text].slice(-100);
      position.current = entries.current.length;
    },
    step: (direction) => {
      const next = position.current + direction;
      if (next < 0 || next > entries.current.length) return null;
      position.current = next;
      // Past the newest input the line is empty again.
      return entries.current[next] ?? "";
    },
  };
}

function isOnEdgeLine(field: HTMLTextAreaElement, direction: -1 | 1): boolean {
  const before = field.value.slice(0, field.selectionStart);
  const after = field.value.slice(field.selectionEnd);
  return direction === -1 ? !before.includes("\n") : !after.includes("\n");
}

/** The text of the input line and its keys: send, new line, recall, interrupt. */
function useTerminalInput(
  commands: SessionCommands,
  canInterrupt: boolean,
): {
  readonly text: string;
  readonly setText: (text: string) => void;
  readonly send: () => Promise<void>;
  readonly handleKeyDown: (
    event: React.KeyboardEvent<HTMLTextAreaElement>,
  ) => void;
} {
  const [text, setText] = useState("");
  const history = useInputHistory();
  async function send(): Promise<void> {
    if (commands.isPending || text.trim() === "") return;
    const sent = text;
    if (!(await commands.send(sent))) return;
    history.remember(sent);
    setText("");
  }
  function interrupt(event: React.KeyboardEvent<HTMLTextAreaElement>): void {
    event.preventDefault();
    if (canInterrupt) void commands.cancel("turn");
  }
  function recall(
    event: React.KeyboardEvent<HTMLTextAreaElement>,
    direction: -1 | 1,
  ): void {
    if (!isOnEdgeLine(event.currentTarget, direction)) return;
    const recalled = history.step(direction);
    if (recalled === null) return;
    event.preventDefault();
    setText(recalled);
  }
  function handleKeyDown(
    event: React.KeyboardEvent<HTMLTextAreaElement>,
  ): void {
    const field = event.currentTarget;
    if (event.nativeEvent.isComposing) return;
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void send();
    } else if (event.key === "Escape") interrupt(event);
    else if (
      event.key === "c" &&
      event.ctrlKey &&
      field.selectionStart === field.selectionEnd
    )
      interrupt(event);
    else if (event.key === "ArrowUp") recall(event, -1);
    else if (event.key === "ArrowDown") recall(event, 1);
  }
  return { text, setText, send, handleKeyDown };
}

/**
 * The input line of the Pages terminal: `❯`, a block cursor and the hint below (PAGE-284).
 *
 * @remarks
 * Enter sends, Shift+Enter starts a new line, and pasted lines stay one
 * input. Arrow up and down bring back the own inputs of this console. Strg+C
 * without a selection and Escape interrupt the running step. Every input goes
 * the steer way of the session, the same for every provider; the server
 * checks the right to run the plan again.
 */
export function ConsoleTerminalInput({
  commands,
  canInterrupt,
}: ConsoleTerminalInputProps): React.ReactElement {
  const { t } = useTranslation();
  const { text, setText, send, handleKeyDown } = useTerminalInput(
    commands,
    canInterrupt,
  );
  const rows = Math.min(MAXIMUM_ROWS, text.split("\n").length);
  return (
    <form
      className="mx-[22px] border-t border-agent-terminal-rule pt-2.5 pb-3 font-mono"
      onSubmit={(event) => {
        event.preventDefault();
        void send();
      }}
    >
      <div className="flex items-start gap-2 text-[15px] leading-[1.65]">
        <span aria-hidden="true" className="text-agent-terminal-accent">
          ❯
        </span>
        <div className="relative min-w-0 flex-1">
          {text === "" ? (
            <span
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 truncate text-agent-terminal-muted"
            >
              <span className="mr-2 animate-pulse text-agent-terminal-strong">
                █
              </span>
              {t("plans.console.terminal.placeholder")}
            </span>
          ) : null}
          <textarea
            value={text}
            rows={rows}
            maxLength={MAXIMUM_INSTRUCTION}
            spellCheck={false}
            aria-label={t("plans.console.terminal.inputLabel")}
            aria-describedby="terminal-input-hint"
            onChange={(event) => setText(event.target.value)}
            onKeyDown={handleKeyDown}
            className={`block w-full resize-none bg-transparent p-0 text-agent-terminal-strong outline-none [caret-shape:block] ${text === "" ? "caret-transparent" : "caret-agent-terminal-strong"}`}
          />
        </div>
      </div>
      <p
        id="terminal-input-hint"
        className="mt-1.5 text-xs text-agent-terminal-muted"
      >
        {t("plans.console.terminal.hint")}
      </p>
      {commands.notice?.tone === "alert" ? (
        <p role="alert" className="mt-1 text-xs text-agent-terminal-error">
          {t([
            `settings.agents.error.${commands.notice.code}`,
            "settings.agents.error.general",
          ])}
        </p>
      ) : null}
    </form>
  );
}
