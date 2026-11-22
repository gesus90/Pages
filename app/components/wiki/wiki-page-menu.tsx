import { MoreHorizontal, Star } from "lucide-react";
import { useRef } from "react";
import { useTranslation } from "react-i18next";
import { useFetcher } from "react-router";

import { Button } from "@/app/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/app/components/ui/dropdown-menu";

import type { WikiPagePermissions } from "@/definition/Wiki";

/** The dialogs the page menu opens. */
export type WikiPageDialog =
  | "anchors"
  | "currentUntil"
  | "delete"
  | "duplicate"
  | "history"
  | "move"
  | "owner"
  | "template";

interface WikiPageMenuProps {
  readonly pageId: string;
  readonly isPrivate: boolean;
  readonly isFavorite: boolean;
  readonly permissions: WikiPagePermissions;
  readonly onOpen: (dialog: WikiPageDialog) => void;
  /** The button that opens the comments, between favorite and menu. */
  readonly commentsButton: React.ReactNode;
  /** Opens the comments with the box for a new comment focused. */
  readonly onWriteComment: () => void;
}

/** The star that marks the page as a favorite, at once while it is saved. */
function FavoriteButton({
  pageId,
  isFavorite,
}: {
  readonly pageId: string;
  readonly isFavorite: boolean;
}): React.ReactElement {
  const { t } = useTranslation();
  const favorite = useFetcher();
  const isMarked = favorite.formData
    ? favorite.formData.get("favorite") === "1"
    : isFavorite;

  return (
    <Button
      aria-label={t(isMarked ? "wiki.page.unfavorite" : "wiki.page.favorite")}
      aria-pressed={isMarked}
      size="icon-sm"
      variant="ghost"
      onClick={() =>
        void favorite.submit(
          {
            favorite: isMarked ? "0" : "1",
            intent: "set-favorite",
            pageId,
          },
          { action: "/wiki", method: "post" },
        )
      }
    >
      <Star
        aria-hidden="true"
        className={isMarked ? "size-4 fill-current text-warning" : "size-4"}
      />
    </Button>
  );
}

/**
 * The buttons above a page: favorite, comments and the menu of everything
 * else.
 */
export function WikiPageMenu({
  pageId,
  isPrivate,
  isFavorite,
  permissions,
  onOpen,
  commentsButton,
  onWriteComment,
}: WikiPageMenuProps): React.ReactElement {
  const { t } = useTranslation();
  // The box for a new comment keeps the focus instead of the menu button.
  const isWritingComment = useRef(false);
  const items: readonly {
    readonly dialog: WikiPageDialog;
    readonly isShown: boolean;
    readonly isDestructive?: boolean;
  }[] = [
    { dialog: "history", isShown: true },
    { dialog: "move", isShown: permissions.canManage },
    { dialog: "duplicate", isShown: permissions.canEdit },
    { dialog: "template", isShown: permissions.canEdit },
    { dialog: "anchors", isShown: permissions.canManage && !isPrivate },
    { dialog: "currentUntil", isShown: permissions.canManage },
    { dialog: "owner", isShown: permissions.canManage && !isPrivate },
    {
      dialog: "delete",
      isDestructive: true,
      isShown: permissions.canManage,
    },
  ];

  function handleWriteComment(): void {
    isWritingComment.current = true;
    onWriteComment();
  }

  return (
    <div className="flex items-center gap-1.5">
      <FavoriteButton isFavorite={isFavorite} pageId={pageId} />
      {commentsButton}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            aria-label={t("wiki.page.menu")}
            size="icon-sm"
            variant="ghost"
          >
            <MoreHorizontal aria-hidden="true" className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          onCloseAutoFocus={(event) => {
            if (isWritingComment.current) {
              isWritingComment.current = false;
              event.preventDefault();
            }
          }}
        >
          {permissions.canComment ? (
            <>
              <DropdownMenuItem onSelect={handleWriteComment}>
                {t("wiki.page.action.comment")}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
            </>
          ) : null}
          {items
            .filter((item) => item.isShown)
            .map((item) => (
              <div key={item.dialog}>
                {item.isDestructive ? <DropdownMenuSeparator /> : null}
                <DropdownMenuItem
                  className={
                    item.isDestructive ? "text-destructive" : undefined
                  }
                  onSelect={() => onOpen(item.dialog)}
                >
                  {t(`wiki.page.action.${item.dialog}`)}
                </DropdownMenuItem>
              </div>
            ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
