import { Copy, X } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";

import { PicaMascot } from "./pica-mascot";

import type { ChatSession, ChatContextSize } from "@/definition/Chat";

interface ChatHeaderProps {
  readonly session: ChatSession | null;
  /** Accepted for existing callers; context is displayed by the composer. */
  readonly context?: ChatContextSize | null;
  readonly onClose: () => void;
}

/** Name of the agent, the read-only session ID and the close button (T6.12.1). */
export function ChatHeader({
  session,
  onClose,
}: ChatHeaderProps): React.ReactElement {
  const { t } = useTranslation();
  const sessionId = session?.id ?? "";

  function handleCopy(): void {
    void navigator.clipboard?.writeText(sessionId);
  }

  return (
    <header className="flex flex-col gap-2 border-b border-border px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <PicaMascot className="size-9" />
          <div>
            <h2 className="font-semibold" id="pica-chat-title">
              {t("chat.title")}
            </h2>
            <p className="text-xs text-muted-foreground">
              {t("chat.subtitle")}
            </p>
          </div>
        </div>
        <Button
          aria-label={t("chat.close")}
          onClick={onClose}
          size="icon"
          variant="ghost"
        >
          <X aria-hidden="true" className="size-4" />
        </Button>
      </div>
      <div className="flex items-center gap-1.5 rounded-lg bg-muted px-2 py-0.5 text-xs">
        <span className="text-muted-foreground">{t("chat.session")}</span>
        <input
          aria-label={t("chat.sessionId")}
          className="min-w-0 flex-1 bg-transparent font-mono text-[0.6875rem] leading-5 text-foreground outline-none"
          readOnly
          value={sessionId}
        />
        <Button
          aria-label={t("chat.copySession")}
          className="size-6 min-h-6 xl:min-h-6"
          disabled={sessionId === ""}
          onClick={handleCopy}
          size="icon-sm"
          title={t("chat.copySession")}
          variant="ghost"
        >
          <Copy aria-hidden="true" className="size-3.5" />
        </Button>
      </div>
    </header>
  );
}
