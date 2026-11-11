import { Globe } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/app/components/ui/dialog";

import { useChatContent } from "./content/chat-content-context";

interface ChatPageEmbedDomainsProps {
  /** The stored conversation; `null` for one that has no settings yet. */
  readonly conversationId: string | null;
  /** The domains members released for the conversation. */
  readonly domains: readonly string[];
  readonly onRemove: (domain: string) => void;
}

/**
 * The domains released for embedding in one conversation, as its settings
 * list them (PAGE-298). Every member can take a release back.
 *
 * @returns The section, or `null` when the conversation is not stored yet.
 */
export function ChatPageEmbedDomains({
  conversationId,
  domains,
  onRemove,
}: ChatPageEmbedDomainsProps): React.ReactElement | null {
  const { t } = useTranslation();
  if (conversationId === null) return null;
  return (
    <section
      aria-label={t("chatPage.embedDomains.title")}
      data-embed-domains={conversationId}
    >
      <h3 className="text-sm font-semibold text-foreground">
        {t("chatPage.embedDomains.title")}
      </h3>
      <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
        {t("chatPage.embedDomains.description")}
      </p>
      {domains.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">
          {t("chatPage.embedDomains.empty")}
        </p>
      ) : (
        <ul className="mt-3 flex flex-col gap-1.5">
          {domains.map((domain) => (
            <li
              className="flex items-center gap-3 rounded-lg bg-muted py-1.5 pr-1.5 pl-3"
              key={domain}
            >
              <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                {domain}
              </span>
              <Button
                aria-label={t("chatPage.embedDomains.removeDomain", { domain })}
                onClick={() => onRemove(domain)}
                size="sm"
                type="button"
                variant="outline"
              >
                {t("chatPage.embedDomains.remove")}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * The released domains of the opened conversation, read from the shared
 * state of the content cards, for a settings dialog in the chat header.
 */
export function ChatPageOpenedEmbedDomains(): React.ReactElement | null {
  const content = useChatContent();
  return (
    <ChatPageEmbedDomains
      conversationId={content.conversationId}
      domains={content.releasedDomains}
      onRemove={(domain) => content.setDomainReleased(domain, false)}
    />
  );
}

/**
 * The header button of a conversation without a member dialog, such as one
 * with a person, and the small dialog with the released domains it opens.
 *
 * @returns The button with its dialog, or `null` when the conversation is
 * not stored and so has nothing released.
 */
export function ChatPageEmbedDomainsButton(): React.ReactElement | null {
  const { t } = useTranslation();
  const content = useChatContent();
  const [isOpen, setIsOpen] = useState(false);
  if (content.conversationId === null) return null;
  return (
    <>
      <Button
        aria-haspopup="dialog"
        onClick={() => setIsOpen(true)}
        size="sm"
        type="button"
        variant="outline"
      >
        <Globe aria-hidden="true" className="size-3.5" />
        {t("chatPage.embedDomains.title")}
      </Button>
      <Dialog onOpenChange={setIsOpen} open={isOpen}>
        <DialogContent size="sm">
          <DialogTitle className="text-lg font-semibold">
            {t("chatPage.embedDomains.dialogTitle")}
          </DialogTitle>
          <DialogDescription className="sr-only">
            {t("chatPage.embedDomains.description")}
          </DialogDescription>
          <div className="mt-4">
            <ChatPageOpenedEmbedDomains />
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
