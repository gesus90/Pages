import { useState } from "react";
import { useTranslation } from "react-i18next";

import { useRegionFormatter } from "@/app/components/common/region-provider";
import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { cn } from "@/app/lib/cn";

import type { ChatConfirmationWord, ChatSession } from "@/definition/Chat";
import type { ChatPicker } from "./use-chat-commands";

interface ChatSessionPickerProps {
  readonly picker: ChatPicker;
  readonly currentId: string;
  readonly confirmationWord: ChatConfirmationWord;
  readonly onChoose: (sessionId: string) => void;
  readonly onRemove: (sessionId: string, confirmation: string) => void;
  readonly onClose: () => void;
}

function SessionLabel({
  session,
  isCurrent,
}: {
  readonly session: ChatSession;
  readonly isCurrent: boolean;
}): React.ReactElement {
  const { t } = useTranslation();
  const { formatDateTime } = useRegionFormatter();
  return (
    <span className="flex min-w-0 flex-col text-left">
      <span className="font-mono text-xs font-semibold">
        {session.id}
        {isCurrent ? ` · ${t("chat.sessions.current")}` : ""}
      </span>
      <span className="truncate text-xs text-muted-foreground">
        {session.preview || t("chat.sessions.empty")} ·{" "}
        {formatDateTime(session.lastMessageAt)}
      </span>
    </span>
  );
}

/**
 * The own sessions after `/sessions` (switch) or `/delete` (choose one and
 * confirm with the typed word, T6.12.3).
 */
export function ChatSessionPicker({
  picker,
  currentId,
  confirmationWord,
  onChoose,
  onRemove,
  onClose,
}: ChatSessionPickerProps): React.ReactElement {
  const { t } = useTranslation();
  // An empty string means that no session is chosen yet.
  const [selected, setSelected] = useState("");
  const [typed, setTyped] = useState("");
  const isDeletion = picker.mode === "delete";
  const canDelete = selected !== "" && typed === confirmationWord;

  function handleSelect(sessionId: string): void {
    if (isDeletion) setSelected(sessionId);
    else onChoose(sessionId);
  }

  function handleRemove(): void {
    onRemove(selected, typed);
  }

  return (
    <div className="pages-thin-scrollbar min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
      <h3 className="text-sm font-semibold">
        {t(isDeletion ? "chat.delete.title" : "chat.sessions.title")}
      </h3>
      {isDeletion ? (
        <p className="text-xs text-muted-foreground">{t("chat.delete.hint")}</p>
      ) : null}
      <ul className="space-y-1.5">
        {picker.sessions.map((session) => (
          <li key={session.id}>
            <button
              aria-pressed={isDeletion ? selected === session.id : undefined}
              className={cn(
                "w-full rounded-xl px-3 py-2 ring-1 ring-border hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-primary",
                selected === session.id && "ring-2 ring-destructive",
              )}
              onClick={() => handleSelect(session.id)}
              type="button"
            >
              <SessionLabel
                isCurrent={session.id === currentId}
                session={session}
              />
            </button>
          </li>
        ))}
      </ul>
      {isDeletion && selected !== "" ? (
        <label className="block space-y-1.5 text-xs">
          <span>{t("chat.delete.confirm", { word: confirmationWord })}</span>
          <Input
            autoComplete="off"
            onChange={(event) => setTyped(event.target.value)}
            value={typed}
          />
        </label>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {isDeletion ? (
          <Button
            disabled={!canDelete}
            onClick={handleRemove}
            variant="destructive"
          >
            {t("chat.delete.submit")}
          </Button>
        ) : null}
        <Button onClick={onClose} variant="outline">
          {t("chat.sessions.close")}
        </Button>
      </div>
    </div>
  );
}
