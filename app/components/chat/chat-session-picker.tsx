import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";

import { ChatSessionDeletion } from "./chat-session-deletion";
import { ChatSessionLabel } from "./chat-session-label";

import type { ChatPicker } from "./use-chat-commands";

interface ChatSessionPickerProps {
  readonly picker: ChatPicker;
  readonly currentId: string;
  readonly isDeleting: boolean;
  readonly error: string | null;
  readonly onChoose: (sessionId: string) => void;
  readonly onRemove: (ids: readonly string[]) => void;
  readonly onClose: () => void;
}

/** Lists own sessions for switching, or presents an explicit bulk deletion selection. */
export function ChatSessionPicker({
  picker,
  currentId,
  isDeleting,
  error,
  onChoose,
  onRemove,
  onClose,
}: ChatSessionPickerProps): React.ReactElement {
  const { t } = useTranslation();
  if (picker.mode === "delete")
    return (
      <ChatSessionDeletion
        picker={picker}
        currentId={currentId}
        isDeleting={isDeleting}
        error={error}
        onRemove={onRemove}
        onClose={onClose}
      />
    );
  return (
    <div className="pages-thin-scrollbar min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
      <h3 className="text-sm font-semibold">{t("chat.sessions.title")}</h3>
      <ul className="space-y-1.5">
        {picker.sessions.map((session) => (
          <li key={session.id}>
            <button
              className="w-full rounded-xl px-3 py-2 ring-1 ring-border hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-primary"
              onClick={() => onChoose(session.id)}
              type="button"
            >
              <ChatSessionLabel
                session={session}
                isCurrent={session.id === currentId}
              />
            </button>
          </li>
        ))}
      </ul>
      <Button onClick={onClose} variant="outline">
        {t("chat.sessions.close")}
      </Button>
    </div>
  );
}
