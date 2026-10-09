import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useFetcher } from "react-router";

import { Button } from "@/app/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/app/components/ui/dialog";
import { Input } from "@/app/components/ui/input";
import { WIKI_LIMITS } from "@/definition/Wiki";

import type { EditorPageLink } from "@/app/components/editor/block-editor-types";
import type { WikiActionResult } from "@/app/lib/wiki-actions/wiki-action-support.server";
import type { WikiPage } from "@/definition/Wiki";

interface WikiSubpageDialogProps {
  readonly parentId: string;
  /** Receives the new page, or `null` when the person cancelled. */
  readonly onDone: (link: EditorPageLink | null) => void;
}

/**
 * Asks for the title of a subpage and creates it below the current page,
 * as `/page` does in Notion. The editor then links the new page.
 */
export function WikiSubpageDialog({
  parentId,
  onDone,
}: WikiSubpageDialogProps): React.ReactElement {
  const { t } = useTranslation();
  const fetcher = useFetcher<WikiActionResult<{ page: WikiPage }>>();
  const [title, setTitle] = useState("");
  const result = fetcher.data;
  const created = result?.ok === true ? result.page : null;
  const isReported = useRef(false);

  useEffect(() => {
    if (created && !isReported.current) {
      isReported.current = true;
      onDone({
        href: `/wiki/${created.id}`,
        icon: created.icon,
        title: created.title,
      });
    }
  }, [created, onDone]);

  return (
    <Dialog open onOpenChange={() => onDone(null)}>
      <DialogContent>
        <DialogTitle className="text-lg font-semibold">
          {t("wiki.subpage.title")}
        </DialogTitle>
        <DialogDescription className="mt-1 text-sm text-muted-foreground">
          {t("wiki.subpage.description")}
        </DialogDescription>
        <fetcher.Form action="/wiki" className="mt-4 space-y-4" method="post">
          <input name="intent" type="hidden" value="create-page" />
          <input name="parentId" type="hidden" value={parentId} />
          <input name="stay" type="hidden" value="1" />
          <label
            className="block text-sm font-medium"
            htmlFor="wiki-subpage-title"
          >
            {t("wiki.dialog.create.titleLabel")}
            <Input
              autoFocus
              className="mt-1"
              id="wiki-subpage-title"
              maxLength={WIKI_LIMITS.titleLength}
              name="title"
              required
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
          </label>
          {result?.ok === false ? (
            <p className="text-sm text-destructive" role="alert">
              {t(`wiki.errors.${result.error}`)}
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => onDone(null)}>
              {t("wiki.dialog.cancel")}
            </Button>
            <Button isPending={fetcher.state !== "idle"} type="submit">
              {t("wiki.dialog.create.submit")}
            </Button>
          </div>
        </fetcher.Form>
      </DialogContent>
    </Dialog>
  );
}
