import { CircleStop, Send } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";
import { Textarea } from "@/app/components/ui/textarea";
import { TERMINAL_PASTE_CHARACTERS } from "@/definition/AgentTerminal";

import type { PlanTerminal } from "./use-plan-terminal";

/**
 * The extended input beside the terminal: several lines sent as one paste,
 * and the interruption of the current agent step.
 *
 * @remarks
 * On a phone it is the only way to intervene, since the terminal there only
 * shows. Enter adds a line; the button or Ctrl+Enter sends the whole text.
 */
export function ConsoleTerminalInput({
  terminal,
}: {
  readonly terminal: PlanTerminal;
}): React.ReactElement {
  const { t } = useTranslation();
  const [text, setText] = useState("");
  async function send(): Promise<void> {
    if (!text.trim()) return;
    if (await terminal.paste(text)) setText("");
  }
  function handleKeyDown(
    event: React.KeyboardEvent<HTMLTextAreaElement>,
  ): void {
    if (
      event.key !== "Enter" ||
      !(event.ctrlKey || event.metaKey) ||
      event.nativeEvent.isComposing
    )
      return;
    event.preventDefault();
    void send();
  }
  return (
    <form
      className="space-y-2 border-t border-border px-4 py-3"
      onSubmit={(event) => {
        event.preventDefault();
        void send();
      }}
    >
      <label htmlFor="terminal-input" className="text-xs font-medium">
        {t("plans.console.terminal.inputLabel")}
      </label>
      <Textarea
        id="terminal-input"
        value={text}
        rows={3}
        maxLength={TERMINAL_PASTE_CHARACTERS}
        placeholder={t("plans.console.terminal.inputPlaceholder")}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={handleKeyDown}
        className="font-mono text-xs"
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="submit"
          size="sm"
          disabled={terminal.isPending || !text.trim()}
        >
          <Send className="size-3.5" aria-hidden="true" />
          {t("plans.console.terminal.send")}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={terminal.isPending}
          onClick={() => void terminal.interrupt()}
        >
          <CircleStop className="size-3.5" aria-hidden="true" />
          {t("plans.console.terminal.interrupt")}
        </Button>
        {terminal.notice ? (
          <p role="status" className="text-xs text-muted-foreground">
            {t(`plans.console.terminal.notice.${terminal.notice}`)}
          </p>
        ) : null}
      </div>
    </form>
  );
}
