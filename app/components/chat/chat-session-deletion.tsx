import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";

import { chatErrorText } from "./chat-error";
import { ChatSessionLabel } from "./chat-session-label";

import type { ChatPicker } from "./use-chat-commands";

interface SessionDeletionProps {
  readonly picker: ChatPicker;
  readonly currentId: string;
  readonly isDeleting: boolean;
  readonly error: string | null;
  readonly onRemove: (ids: readonly string[]) => void;
  readonly onClose: () => void;
}

function DeletionOutcome({
  picker,
  error,
}: {
  readonly picker: ChatPicker;
  readonly error: string | null;
}): React.ReactElement {
  const { t } = useTranslation();
  const outcome = picker.outcome;
  return (
    <>
      {outcome ? (
        <p role="status" className="text-xs text-muted-foreground">
          {t("chat.delete.result", { count: outcome.deleted.length })}
        </p>
      ) : null}
      {outcome?.failed.map(({ sessionId, error: code }) => (
        <p
          key={sessionId}
          role="alert"
          className="break-words text-xs text-destructive"
        >
          {t("chat.delete.failed", { id: sessionId })} {chatErrorText(t, code)}
        </p>
      ))}
      {outcome?.cleanupFailed.map((id) => (
        <p
          key={id}
          role="alert"
          className="break-words text-xs text-destructive"
        >
          {t("chat.delete.cleanupFailed", { id })}
        </p>
      ))}
      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {chatErrorText(t, error)}
        </p>
      ) : null}
    </>
  );
}

/** Button confirmation applies to exactly the currently selected own-session IDs. */
export function ChatSessionDeletion({
  picker,
  currentId,
  isDeleting,
  error,
  onRemove,
  onClose,
}: SessionDeletionProps): React.ReactElement {
  const { t } = useTranslation();
  const [selected, setSelected] = useState<readonly string[]>([]);
  const ids = picker.sessions
    .filter(({ id }) => selected.includes(id))
    .map(({ id }) => id);
  const hasAll = ids.length > 0 && ids.length === picker.sessions.length;

  function toggle(id: string): void {
    setSelected((current) =>
      current.includes(id)
        ? current.filter((entry) => entry !== id)
        : [...current, id],
    );
  }

  function toggleAll(): void {
    setSelected(hasAll ? [] : picker.sessions.map(({ id }) => id));
  }

  return (
    <div
      aria-busy={isDeleting}
      className="pages-thin-scrollbar min-h-0 flex-1 space-y-3 overflow-y-auto p-4"
    >
      <h3 className="text-sm font-semibold">{t("chat.delete.title")}</h3>
      <p className="text-xs text-muted-foreground">{t("chat.delete.hint")}</p>
      <p className="text-xs text-muted-foreground">
        {t("chat.delete.nativeRetention")}
      </p>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={hasAll}
          disabled={isDeleting || picker.sessions.length === 0}
          onChange={toggleAll}
        />
        {t("chat.delete.all", { count: picker.sessions.length })}
      </label>
      <ul className="space-y-1.5">
        {picker.sessions.map((session) => (
          <li key={session.id}>
            <label className="flex cursor-pointer items-center gap-2 rounded-xl px-3 py-2 ring-1 ring-border hover:bg-surface-hover focus-within:outline-2 focus-within:outline-primary">
              <input
                type="checkbox"
                checked={ids.includes(session.id)}
                disabled={isDeleting}
                onChange={() => toggle(session.id)}
              />
              <ChatSessionLabel
                session={session}
                isCurrent={session.id === currentId}
              />
            </label>
          </li>
        ))}
      </ul>
      <p className="text-xs font-medium" role="status">
        {t("chat.delete.extent", { count: ids.length })}
      </p>
      <DeletionOutcome picker={picker} error={error} />
      {isDeleting ? (
        <p role="status" className="text-xs text-muted-foreground">
          {t("chat.delete.pending")}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button
          disabled={isDeleting || ids.length === 0}
          onClick={() => onRemove(ids)}
          variant="destructive"
        >
          {t("chat.delete.submit", { count: ids.length })}
        </Button>
        <Button disabled={isDeleting} onClick={onClose} variant="outline">
          {t("chat.cancel")}
        </Button>
      </div>
    </div>
  );
}
