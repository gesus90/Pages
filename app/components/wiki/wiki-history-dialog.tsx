import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useFetcher } from "react-router";

import { useRegionFormatter } from "@/app/components/common/region-provider";
import { Button } from "@/app/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/app/components/ui/dialog";
import { WikiMarkdown } from "@/app/components/wiki/wiki-markdown";
import { wikiPagePath } from "@/app/lib/wiki-tree";

import type { WikiActionResult } from "@/app/lib/wiki-actions/wiki-action-support.server";
import type { WikiPage } from "@/definition/Wiki";

/** A stored version as the history lists it. */
export interface WikiVersionEntry {
  readonly id: string;
  readonly revision: number;
  readonly authorName: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

interface WikiHistoryDialogProps {
  readonly page: WikiPage;
  readonly versions: readonly WikiVersionEntry[];
  readonly canRestore: boolean;
  readonly onClose: () => void;
}

/** Lists the versions of a page, previews one and restores it as a new one. */
export function WikiHistoryDialog({
  page,
  versions,
  canRestore,
  onClose,
}: WikiHistoryDialogProps): React.ReactElement {
  const { t } = useTranslation();
  const { formatDateTime } = useRegionFormatter();
  const preview =
    useFetcher<
      WikiActionResult<{ version: { id: string; content: string } }>
    >();
  const restore = useFetcher<WikiActionResult>();
  const action = wikiPagePath(page.id);
  const shown = preview.data?.ok === true ? preview.data.version : null;
  const hasRestored = restore.data?.ok === true;

  useEffect(() => {
    if (hasRestored) {
      onClose();
    }
  }, [hasRestored, onClose]);

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="overflow-y-auto" size="lg">
        <DialogTitle className="text-lg font-semibold">
          {t("wiki.dialog.history.title")}
        </DialogTitle>
        <DialogDescription className="mt-1 text-sm text-muted-foreground">
          {t("wiki.dialog.history.description")}
        </DialogDescription>
        <ul className="mt-4 divide-y divide-border">
          {versions.map((version) => (
            <li
              key={version.id}
              className="flex items-center justify-between gap-3 py-2"
            >
              <div className="min-w-0 text-sm">
                <p className="font-medium">
                  {t("wiki.dialog.history.version", {
                    revision: version.revision,
                  })}
                </p>
                <p className="truncate text-muted-foreground">
                  {version.authorName} · {formatDateTime(version.updatedAt)}
                </p>
              </div>
              <div className="flex shrink-0 gap-2">
                <preview.Form action={action} method="post">
                  <input name="intent" type="hidden" value="get-version" />
                  <input name="versionId" type="hidden" value={version.id} />
                  <Button size="sm" type="submit" variant="outline">
                    {t("wiki.dialog.history.preview")}
                  </Button>
                </preview.Form>
                {canRestore ? (
                  <restore.Form action={action} method="post">
                    <input
                      name="intent"
                      type="hidden"
                      value="restore-version"
                    />
                    <input name="versionId" type="hidden" value={version.id} />
                    <Button size="sm" type="submit">
                      {t("wiki.dialog.history.restore")}
                    </Button>
                  </restore.Form>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
        {restore.data?.ok === false ? (
          <p className="mt-2 text-sm text-destructive" role="alert">
            {t(`wiki.errors.${restore.data.error}`)}
          </p>
        ) : null}
        {shown ? (
          <div
            aria-label={t("wiki.dialog.history.previewLabel")}
            className="mt-4 max-h-72 overflow-y-auto rounded-xl border border-border p-4"
          >
            <WikiMarkdown source={shown.content} />
          </div>
        ) : null}
        <div className="mt-4 flex justify-end">
          <Button variant="ghost" onClick={onClose}>
            {t("wiki.dialog.close")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
