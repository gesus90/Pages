import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/app/components/ui/dialog";
import { WikiActionDialog } from "@/app/components/wiki/wiki-action-dialog";

import type { WikiPrivatePlaceholder } from "@/definition/Wiki";

interface UserPrivateWikiPagesProps {
  readonly ownerName: string;
  readonly pages: readonly WikiPrivatePlaceholder[];
}

/**
 * Shows an administrator how many private wiki pages an account has and
 * lists them as placeholders: the address and the way to delete, never a
 * title or text.
 */
export function UserPrivateWikiPages({
  ownerName,
  pages,
}: UserPrivateWikiPagesProps): React.ReactElement | null {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  if (pages.length === 0) {
    return null;
  }

  return (
    <>
      <button
        className="w-fit cursor-pointer rounded text-xs text-muted-foreground underline-offset-2 outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-primary"
        type="button"
        onClick={() => setIsOpen(true)}
      >
        {t("users.privateWiki.count", { count: pages.length })}
      </button>
      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent>
          <DialogTitle className="text-lg font-semibold">
            {t("users.privateWiki.title", { name: ownerName })}
          </DialogTitle>
          <DialogDescription className="mt-1 text-sm text-muted-foreground">
            {t("users.privateWiki.description")}
          </DialogDescription>
          <ul className="mt-4 flex flex-col gap-2">
            {pages.map((page) => (
              <li
                key={page.id}
                className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2"
              >
                <span className="pages-selectable truncate font-mono text-sm">
                  /wiki/{page.id}
                </span>
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={() => setDeletingId(page.id)}
                >
                  {t("users.privateWiki.delete")}
                </Button>
              </li>
            ))}
          </ul>
          <div className="mt-4 flex justify-end">
            <DialogClose asChild>
              <Button type="button" variant="ghost">
                {t("users.privateWiki.close")}
              </Button>
            </DialogClose>
          </div>
        </DialogContent>
      </Dialog>
      {deletingId === null ? null : (
        <WikiActionDialog
          action="/wiki"
          description={t("wiki.placeholder.deleteDescription", {
            name: ownerName,
          })}
          fields={{
            intent: "delete-private-page",
            pageId: deletingId,
            stay: "1",
          }}
          isDestructive
          submitLabel={t("users.privateWiki.delete")}
          title={t("wiki.placeholder.deleteTitle")}
          onClose={() => setDeletingId(null)}
        />
      )}
    </>
  );
}
