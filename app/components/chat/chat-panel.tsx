import { ChatComposer } from "./chat-composer";
import { ChatHeader } from "./chat-header";
import { ChatMessageList } from "./chat-message-list";
import { ChatPasswordReceipts } from "./chat-password-receipts";
import { ChatSessionPicker } from "./chat-session-picker";
import { useChat } from "./use-chat";

interface ChatPanelProps {
  readonly isOpen: boolean;
  readonly onClose: () => void;
}

/**
 * The floating chat panel above the content (T6.12.1); it keeps its state
 * while hidden, so a running answer and a draft survive closing it.
 */
export function ChatPanel({
  isOpen,
  onClose,
}: ChatPanelProps): React.ReactElement {
  const chat = useChat(isOpen);
  const { picker } = chat.commands;
  const { view } = chat;

  function handleKeyDown(event: React.KeyboardEvent<HTMLElement>): void {
    if (event.key !== "Escape") return;
    event.stopPropagation();
    if (picker) chat.commands.closePicker();
    else onClose();
  }

  return (
    <section
      aria-labelledby="pica-chat-title"
      className="fixed inset-x-2 top-16 bottom-[calc(env(safe-area-inset-bottom)+8rem)] z-40 flex flex-col overflow-hidden rounded-2xl bg-surface shadow-panel ring-1 ring-border sm:inset-x-auto sm:right-4 sm:w-[26rem] md:top-auto md:bottom-[calc(env(safe-area-inset-bottom)+5rem)] md:h-[min(40rem,calc(100dvh-7rem))]"
      hidden={!isOpen}
      id="pica-chat"
      onKeyDown={handleKeyDown}
    >
      <ChatHeader onClose={onClose} session={view.session} />
      {picker ? (
        <ChatSessionPicker
          key={picker.mode}
          currentId={view.session?.id ?? ""}
          isDeleting={chat.commands.isDeleting}
          error={chat.error}
          onChoose={(sessionId) => void chat.commands.choose(sessionId)}
          onClose={chat.commands.closePicker}
          onRemove={(ids) => void chat.commands.remove(ids)}
          picker={picker}
        />
      ) : (
        <ChatMessageList chat={chat} isOpen={isOpen} />
      )}
      <ChatPasswordReceipts
        receipts={chat.temporaryPasswords}
        onDismiss={chat.dismissTemporaryPasswords}
      />
      <ChatComposer chat={chat} isOpen={isOpen} />
    </section>
  );
}
