import { ImageIcon, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useFetcher } from "react-router";

import { Button } from "@/app/components/ui/button";
import { cn } from "@/app/lib/cn";

import styles from "@/app/components/wiki/wiki-page-cover.module.css";

import type { WikiCover } from "@/definition/Wiki";

interface WikiPageCoverProps {
  readonly pageId: string;
  readonly cover: WikiCover;
  readonly canEdit: boolean;
  readonly onChoose: () => void;
}

/**
 * Draws a cover: a prepared gradient or an image of the page.
 *
 * @param props - The cover and the classes of its frame.
 * @returns The cover surface.
 */
export function CoverSurface({
  cover,
  className,
}: {
  readonly cover: WikiCover;
  readonly className?: string;
}): React.ReactElement {
  return cover.kind === "preset" ? (
    <div aria-hidden="true" className={cn(styles[cover.preset], className)} />
  ) : (
    <img
      alt=""
      className={cn("object-cover", className)}
      draggable={false}
      src={`/wiki/attachments/${cover.attachmentId}`}
    />
  );
}

/**
 * The optional cover above the title. Editors change or remove it with the
 * buttons that appear on hover, on focus and always on touch screens.
 */
export function WikiPageCover({
  pageId,
  cover,
  canEdit,
  onChoose,
}: WikiPageCoverProps): React.ReactElement {
  const { t } = useTranslation();
  const fetcher = useFetcher();

  return (
    <div className="group relative">
      <CoverSurface className="h-44 w-full rounded-2xl md:h-56" cover={cover} />
      {canEdit ? (
        <div className="absolute right-3 bottom-3 flex gap-2 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100">
          <Button size="xs" variant="outline" onClick={onChoose}>
            <ImageIcon aria-hidden="true" className="size-3.5" />
            {t("wiki.cover.change")}
          </Button>
          <Button
            isPending={fetcher.state !== "idle"}
            size="xs"
            variant="outline"
            onClick={() =>
              void fetcher.submit(
                { cover: "", intent: "set-cover" },
                { action: `/wiki/${pageId}`, method: "post" },
              )
            }
          >
            <Trash2 aria-hidden="true" className="size-3.5" />
            {t("wiki.cover.remove")}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
