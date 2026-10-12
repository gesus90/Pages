import { Copy, X } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";

import picaIconUrl from "@/assets/pica-icon.svg";

import type { ChatSession } from "@/definition/Chat";

interface ChatHeaderProps {
  readonly session: ChatSession | null;
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
    <header className="flex flex-col gap-3 border-b border-border p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <img alt="" className="size-9 rounded-xl" src={picaIconUrl} />
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
      <div className="flex items-center gap-2 rounded-xl bg-muted px-3 py-1.5 text-xs">
        <span className="text-muted-foreground">{t("chat.session")}</span>
        <input
          aria-label={t("chat.sessionId")}
          className="min-w-0 flex-1 bg-transparent font-mono font-semibold text-foreground outline-none"
          readOnly
          value={sessionId}
        />
        <Button
          aria-label={t("chat.copySession")}
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
