import { FolderOpen, Menu } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/app/components/ui/dropdown-menu";

import { ChatPageMenuEntry, MENU_SECTION_LABEL } from "../chat-page-menu-entry";
import { useChatContent } from "../content/chat-content-context";
import { useMediaOverview } from "./media-overview-api";

/**
 * The entry "Medien & Dateien" with the count of files and links of the chat
 * (PAGE-387), the first entry of the chat menu. The count is read anew each
 * time the menu opens, from the server, which answers only members.
 *
 * @param conversationId - The stored conversation; `null` counts nothing.
 * @param openings - How often the menu opened; a change reads the count again.
 */
export function MediaMenuEntry({
  conversationId,
  openings,
}: {
  readonly conversationId: string | null;
  readonly openings: number;
}): React.ReactElement {
  const { t } = useTranslation();
  const { openMedia } = useChatContent();
  const { overview } = useMediaOverview(
    conversationId,
    openings > 0 ? String(openings) : null,
  );
  const count = overview ? overview.files.length + overview.links.length : null;
  return (
    <ChatPageMenuEntry
      icon={FolderOpen}
      label={t("chatPage.media.menuEntry")}
      note={count === null && conversationId !== null ? "…" : String(count ?? 0)}
      onSelect={openMedia}
    />
  );
}

/**
 * Counts how often a menu opened, so its entries read their data anew.
 *
 * @returns Whether the menu is open, its change, and the count of openings.
 */
export function useMenuOpenings(): {
  readonly isOpen: boolean;
  readonly openings: number;
  onOpenChange(isOpen: boolean): void;
} {
  const [isOpen, setOpen] = useState(false);
  const [openings, setOpenings] = useState(0);
  return {
    isOpen,
    openings,
    onOpenChange: (next) => {
      setOpen(next);
      if (next) setOpenings((count) => count + 1);
    },
  };
}

/**
 * The menu ☰ of a direct chat in the head (PAGE-387): "Medien & Dateien"
 * with its count as its first entry, until the chat menu of PAGE-389 takes
 * this place.
 */
export function ChatPageChatMenu({
  conversationId,
  name,
}: {
  readonly conversationId: string | null;
  readonly name: string;
}): React.ReactElement {
  const { t } = useTranslation();
  const menu = useMenuOpenings();
  return (
    <DropdownMenu open={menu.isOpen} onOpenChange={menu.onOpenChange}>
      <DropdownMenuTrigger asChild>
        <Button aria-label={t("chatPage.chatMenu.label")} size="sm" variant="outline">
          <Menu aria-hidden="true" className="size-3.5" />
          {t("chatPage.chatMenu.trigger")}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuLabel className={MENU_SECTION_LABEL}>
          {t("chatPage.chatMenu.section", { name })}
        </DropdownMenuLabel>
        <MediaMenuEntry conversationId={conversationId} openings={menu.openings} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
