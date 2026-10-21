import { Send } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";
import { Textarea } from "@/app/components/ui/textarea";

import type {
  AgentSessionMessage,
  AgentSessionMessageStatus,
  AgentSessionView,
} from "@/definition/AgentSessionJournal";
import type { SessionCommands } from "./use-session-commands";

interface ConsoleComposerProps {
  readonly view: AgentSessionView;
  readonly isReadOnly: boolean;
  readonly commands: SessionCommands;
}

/** Why the field takes no instruction now; `null` when it does. */
function lockReason(
  view: AgentSessionView,
  isReadOnly: boolean,
): string | null {
  if (isReadOnly) return "plans.console.lock.history";
  if (view.actions.canSend) return null;
  const { mode, reason } = view.continuation;
  if (mode === "unavailable" && reason)
    return `plans.console.continuation.reason.${reason}`;
  return "plans.console.lock.noSession";
}

// Delivered and cancelled instructions are in the history; these still need the reader's attention.
const OPEN_STATUSES: ReadonlySet<AgentSessionMessageStatus> = new Set([
  "queued",
  "delivering",
  "uncertain",
  "failed",
]);
// The newest open instructions shown above the field.
const OPEN_LIMIT = 5;

/** Queued, delivering, uncertain and failed instructions with their delivery status. */
function OpenMessages({
  messages,
}: {
  readonly messages: readonly AgentSessionMessage[];
}): React.ReactElement | null {
  const { t } = useTranslation();
  const open = messages
    .filter((message) => OPEN_STATUSES.has(message.status))
    .slice(-OPEN_LIMIT);
  if (open.length === 0) return null;
  return (
    <ul
      aria-label={t("plans.console.openMessages")}
      className="space-y-1 text-xs"
    >
      {open.map((message) => (
        <li key={message.id} className="flex min-w-0 gap-2">
          <span className="shrink-0 font-medium">
            {t(`plans.console.message.${message.status}`)}
          </span>
          <span
            title={message.text}
            className="min-w-0 truncate text-muted-foreground"
          >
            {message.text}
          </span>
        </li>
      ))}
    </ul>
  );
}

function NoticeLine({
  commands,
}: {
  readonly commands: SessionCommands;
}): React.ReactElement | null {
  const { t } = useTranslation();
  const { notice } = commands;
  if (!notice) return null;
  return notice.tone === "alert" ? (
    <p role="alert" className="text-xs text-destructive">
      {t([
        `settings.agents.error.${notice.code}`,
        "settings.agents.error.general",
      ])}
    </p>
  ) : (
    <p role="status" className="text-xs text-muted-foreground">
      {t(`plans.console.result.${notice.code}`)}
    </p>
  );
}

/**
 * The instruction field: Enter sends, Shift+Enter breaks the line, an IME composition is never sent.
 *
 * @remarks
 * The original plan assignment stays as it is; an instruction is a turn of
 * its own. While a turn runs the backend queues the instruction and says so.
 */
export function ConsoleComposer({
  view,
  isReadOnly,
  commands,
}: ConsoleComposerProps): React.ReactElement {
  const { t } = useTranslation();
  const [text, setText] = useState("");
  const field = useRef<HTMLTextAreaElement | null>(null);
  const reason = lockReason(view, isReadOnly);
  const isLocked = reason !== null;
  const canFocus = !isLocked;
  const hasFocused = useRef(false);
  // The field takes the focus once, when it first accepts input; later state changes never steal it.
  useEffect(() => {
    if (!canFocus || hasFocused.current) return;
    hasFocused.current = true;
    field.current?.focus({ preventScroll: true });
  }, [canFocus]);
  async function submit(): Promise<void> {
    if (isLocked || commands.isPending || text.trim() === "") return;
    if (await commands.send(text)) setText("");
  }
  function onKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>): void {
    if (event.key !== "Enter" || event.shiftKey) return;
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    event.preventDefault();
    void submit();
  }
  return (
    <form
      className="space-y-2 border-t border-border px-5 py-3"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      {reason ? (
        <p id="console-lock" className="text-xs text-muted-foreground">
          {t(reason)}
        </p>
      ) : null}
      <OpenMessages messages={view.messages} />
      {!isLocked && view.state === "running" ? (
        <p className="text-xs text-muted-foreground">
          {t("plans.console.queueHint")}
        </p>
      ) : null}
      <div className="flex items-end gap-2">
        <Textarea
          containerClassName="flex-1"
          ref={field}
          rows={2}
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={onKeyDown}
          disabled={isLocked}
          aria-label={t("plans.console.instruction")}
          aria-describedby={reason ? "console-lock" : undefined}
          placeholder={t("plans.console.placeholder")}
          className="max-h-40 min-h-11 flex-1 resize-none"
        />
        <Button
          type="submit"
          size="icon"
          disabled={isLocked || commands.isPending || text.trim() === ""}
          aria-label={t("plans.console.send")}
        >
          <Send className="size-4" aria-hidden="true" />
        </Button>
      </div>
      <NoticeLine commands={commands} />
    </form>
  );
}
